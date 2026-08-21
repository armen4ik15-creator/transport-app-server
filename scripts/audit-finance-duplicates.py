# -*- coding: utf-8 -*-
"""Strict finance duplicate audit + optional --fix to delete true dups."""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / "timeweb.env"
BASE = "https://armen4ik15-creator-transport-app-server-26b3.twc1.net"
OUT = Path(__file__).resolve().parent / "_finance_dup_audit.json"

vars_: dict[str, str] = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vars_[k.strip()] = v.strip().strip('"').strip("'")

MARKER_RE = re.compile(r"\[[^\]]+\]")
STRICT_PREFIXES = (
    "[bank-",
    "[bank-op-",
    "[cpay-",
    "[ppr-topup-",
    "[ppr-fuel-",
    "[opti-fuel-",
    "[fuel-topup-",
    "[cash-aug-",
    "[payroll-jul2]",
)


def req(method: str, path: str, body: dict | None = None, token: str = "", retries: int = 8):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    last = None
    for attempt in range(retries):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read().decode("utf-8")
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"error": raw[:400]}
            return error.code, parsed
        except Exception as error:  # noqa: BLE001
            last = error
            time.sleep(2 + attempt)
    raise RuntimeError(f"{method} {path}: {last}")


def strict_markers(text: str) -> list[str]:
    markers = MARKER_RE.findall(text or "")
    out = []
    for marker in markers:
        lower = marker.lower()
        if any(lower.startswith(prefix.lower().rstrip("]")) or lower == prefix.lower() for prefix in STRICT_PREFIXES):
            out.append(marker)
        elif lower.startswith("[cash-aug-"):
            out.append(marker)
    return out


def find_true_dups(
    rows: list,
    text_key: str,
    *,
    amount_key: str = "amount",
    extra_keys: tuple[str, ...] = (),
) -> list[dict]:
    buckets: dict[tuple, list] = defaultdict(list)
    for row in rows:
        markers = strict_markers(str(row.get(text_key) or ""))
        if not markers:
            continue
        marker = max(markers, key=len)
        key = (marker, round(float(row.get(amount_key) or 0), 2)) + tuple(
            row.get(k) for k in extra_keys
        )
        buckets[key].append(row)

    result = []
    for key, items in sorted(buckets.items(), key=lambda item: str(item[0][0])):
        if len(items) < 2:
            continue
        ordered = sorted(items, key=lambda row: int(row["id"]))
        amount = float(ordered[0].get(amount_key) or 0)
        result.append(
            {
                "marker": key[0],
                "amount": amount,
                "count": len(ordered),
                "keep_id": ordered[0]["id"],
                "delete_ids": [row["id"] for row in ordered[1:]],
                "extra_amount": round(amount * (len(ordered) - 1), 2),
                "sample": {
                    "date": ordered[0].get("exp_date")
                    or ordered[0].get("payment_date")
                    or str(ordered[0].get("created_at") or "")[:10],
                    "type": ordered[0].get("exp_type") or ordered[0].get("type"),
                    "driver": ordered[0].get("driver_name"),
                    "contractor": ordered[0].get("contractor_name"),
                    "text": (ordered[0].get(text_key) or "")[:120],
                },
            }
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="Delete true duplicates (keep lowest id)")
    args = parser.parse_args()

    status, login = req(
        "POST",
        "/api/auth/login",
        {"email": vars_["FOUNDER_ADMIN_EMAIL"], "password": vars_["FOUNDER_ADMIN_PASSWORD"]},
    )
    assert status == 200, login
    token = login["token"]
    print("login ok")

    _, expenses = req("GET", "/api/expenses?from=2026-06-01&to=2026-12-31", token=token)
    _, salary = req("GET", "/api/salary/payments", token=token)
    _, cpays = req("GET", "/api/contractors/payments", token=token)
    expenses = expenses or []
    salary = salary or []
    cpays = cpays or []

    expense_dups = find_true_dups(expenses, "comment")
    salary_dups = find_true_dups(salary, "note", extra_keys=("driver_id",))
    cpay_dups = find_true_dups(cpays, "note")

    report = {
        "counts": {
            "expenses": len(expenses),
            "salary_payments": len(salary),
            "contractor_payments": len(cpays),
        },
        "true_duplicates": {
            "expenses": expense_dups,
            "salary": salary_dups,
            "contractor_payments": cpay_dups,
        },
        "totals_extra": {
            "expenses": round(sum(item["extra_amount"] for item in expense_dups), 2),
            "salary": round(sum(item["extra_amount"] for item in salary_dups), 2),
            "contractor_payments": round(sum(item["extra_amount"] for item in cpay_dups), 2),
        },
        "note_ru": (
            "True duplicate = same strict import marker + same amount "
            "(+ same driver for salary). Shared batch tags like [cash-#10] are NOT duplicates."
        ),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== TRUE DUPLICATES ===")
    print("expenses", len(expense_dups), "extra", report["totals_extra"]["expenses"])
    for item in expense_dups:
        print(" ", item["sample"]["date"], item["amount"], item["marker"], "del", item["delete_ids"])
    print("salary", len(salary_dups), "extra", report["totals_extra"]["salary"])
    for item in salary_dups:
        print(" ", item["sample"]["date"], item["amount"], item["marker"], "del", item["delete_ids"], item["sample"].get("driver"))
    print("cpay", len(cpay_dups), "extra", report["totals_extra"]["contractor_payments"])
    for item in cpay_dups:
        print(" ", item["sample"]["date"], item["amount"], item["marker"], "del", item["delete_ids"], item["sample"].get("contractor"))

    if not args.fix:
        print("\nDry-run only. Re-run with --fix to delete.")
        print("wrote", OUT)
        return

    deleted = []
    for item in expense_dups:
        for expense_id in item["delete_ids"]:
            status, data = req("DELETE", f"/api/expenses/{expense_id}", token=token)
            print("del expense", expense_id, status)
            deleted.append({"type": "expense", "id": expense_id, "status": status})
            time.sleep(0.12)
    for item in salary_dups:
        for payment_id in item["delete_ids"]:
            status, data = req("DELETE", f"/api/salary/payments/{payment_id}", token=token)
            print("del salary", payment_id, status)
            deleted.append({"type": "salary", "id": payment_id, "status": status})
            time.sleep(0.12)
    for item in cpay_dups:
        for payment_id in item["delete_ids"]:
            status, data = req("DELETE", f"/api/contractors/payments/{payment_id}", token=token)
            print("del cpay", payment_id, status)
            deleted.append({"type": "cpay", "id": payment_id, "status": status})
            time.sleep(0.12)

    report["deleted"] = deleted
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("deleted", len(deleted), "wrote", OUT)


if __name__ == "__main__":
    main()

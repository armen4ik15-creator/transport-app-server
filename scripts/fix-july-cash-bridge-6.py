# -*- coding: utf-8 -*-
"""Close residual ~6 RUB cash bridge gap and set exact bank opening."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://armen4ik15-creator-transport-app-server-26b3.twc1.net"
ENV = Path(__file__).resolve().parent.parent / "timeweb.env"
BANK_OPEN = 645611.83
BANK_CLOSE = 374263.73

vars_: dict[str, str] = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vars_[k.strip()] = v.strip().strip('"').strip("'")


def req(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8")
        return response.status, json.loads(raw) if raw else None


def main() -> None:
    _, login = req(
        "POST",
        "/api/auth/login",
        {"email": vars_["FOUNDER_ADMIN_EMAIL"], "password": vars_["FOUNDER_ADMIN_PASSWORD"]},
    )
    token = login["token"]

    status, settings = req(
        "PUT",
        "/api/finance/cash-settings",
        {"opening_cash_balance": BANK_OPEN, "opening_cash_date": "2026-07-01"},
        token=token,
    )
    print("cash-settings", status, settings)

    # Avoid duplicate reconcile row
    _, expenses = req("GET", "/api/expenses?from=2026-07-01&to=2026-07-31", token=token)
    marker = "[cash-reconcile-6]"
    exists = any(marker in str(e.get("comment") or "") for e in (expenses or []))
    if exists:
        print("reconcile-6 already exists")
    else:
        status, created = req(
            "POST",
            "/api/expenses",
            {
                "exp_date": "2026-07-31",
                "exp_type": "other",
                "method": "cash",
                "amount": 6,
                "comment": (
                    f"{marker} Доаллокация личных снятий ИП июль: "
                    "банк personal 1 096 873 − app 1 096 867"
                ),
            },
            token=token,
        )
        print("create reconcile-6", status, created)

    status, cash = req("GET", "/api/finance/cash-summary", token=token)
    est = float(cash["estimated_cash_balance"])
    print("estimated", round(est, 2), "bank_close", BANK_CLOSE, "gap", round(est - BANK_CLOSE, 2))
    print(
        "personal_proxy",
        round(
            float(cash["cash_desk_out"])
            + float(cash["driver_payments_out"])
            + float(cash["imprest_flow_since_opening"]),
            2,
        ),
    )


if __name__ == "__main__":
    main()

# -*- coding: utf-8
"""Archive former drivers and set Vadim opening accrual."""
from __future__ import annotations

import json
import ssl
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / "timeweb.env"
BASE = "https://armen4ik15-creator-transport-app-server-26b3.twc1.net"
CTX = ssl.create_default_context()

vars_: dict[str, str] = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        vars_[k.strip()] = v.strip().strip('"').strip("'")


def api(method: str, path: str, body=None, token: str | None = None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120, context=CTX) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


tok = api(
    "POST",
    "/api/auth/login",
    {"email": vars_["FOUNDER_ADMIN_EMAIL"], "password": vars_["FOUNDER_ADMIN_PASSWORD"]},
)["token"]

actions = [
    (12, {"is_archived": True, "is_active": False}, "Мутаев -> archive"),
    (13, {"is_archived": True, "is_active": False}, "Садаев -> archive"),
    (14, {"is_archived": True, "is_active": False}, "Бухаров -> archive"),
    (
        15,
        {"salary_opening_accrued": 20000, "is_active": False},
        "Вадим -> opening 20000",
    ),
]

for driver_id, payload, label in actions:
    try:
        updated = api("PUT", f"/api/drivers/{driver_id}", payload, token=tok)
        print("OK", label, updated.get("full_name"), "archived=", updated.get("is_archived"))
    except Exception as exc:  # noqa: BLE001
        print("FAIL", label, exc)

debts = api("GET", "/api/salary/debts", token=tok) or []
print("\nVISIBLE DEBTS (non-archived):")
for row in debts:
    print(
        f"  {row['driver_id']} {row['driver_name']}: gross={row['gross']} paid={row['paid']} "
        f"owed={row.get('owed', row.get('debt'))} overpaid={row.get('overpaid', 0)}"
    )

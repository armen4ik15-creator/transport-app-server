"""
Idempotent post of July 2026 cash allocation + bank operating expenses.
Markers in comments: [cash-#N], [bank-op-...]
"""
from __future__ import annotations

import json
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://armen4ik15-creator-transport-app-server-26b3.twc1.net"
ENV = Path(r"C:\Users\Windows\Desktop\ноое приложене\server\timeweb.env")

vars_: dict[str, str] = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vars_[k.strip()] = v.strip().strip('"').strip("'")


def req(method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": raw[:500]}
        return error.code, parsed


def login():
    global TOKEN
    status, data = req(
        "POST",
        "/api/auth/login",
        {
            "email": vars_["FOUNDER_ADMIN_EMAIL"],
            "password": vars_["FOUNDER_ADMIN_PASSWORD"],
        },
    )
    if status >= 400:
        raise RuntimeError(f"login failed: {status} {data}")
    TOKEN = data["token"]
    print("login ok")


TOKEN = ""


def wait_imprest(retries: int = 30) -> None:
    for i in range(retries):
        status, data = req("GET", "/api/finance/imprest")
        if status == 200:
            print("imprest API ready")
            return
        print(f"wait imprest… {status} {data}")
        time.sleep(5)
    raise RuntimeError("imprest API not ready")


def get_drivers() -> dict[str, int]:
    status, data = req("GET", "/api/drivers")
    assert status == 200
    out: dict[str, int] = {}
    for row in data:
        name = (row.get("full_name") or "").strip().lower()
        out[name] = int(row["id"])
    return out


def ensure_driver(name: str, email: str, by_name: dict[str, int]) -> int:
    key = name.strip().lower()
    if key in by_name:
        return by_name[key]
    # partial match surname
    surname = key.split()[0]
    for full, did in by_name.items():
        if full.startswith(surname):
            return did
    password = secrets.token_urlsafe(12) + "Aa1"
    status, data = req(
        "POST",
        "/api/drivers",
        {
            "email": email,
            "password": password,
            "full_name": name,
            "is_active": False,
            "car_number": None,
        },
    )
    if status == 409:
        # email taken — find by listing again after refresh
        by_name.update(get_drivers())
        if key in by_name:
            return by_name[key]
        raise RuntimeError(f"driver conflict {name}: {data}")
    if status >= 400:
        raise RuntimeError(f"create driver {name}: {status} {data}")
    did = int(data["id"])
    by_name[key] = did
    print(f"driver created {did} {name}")
    return did


def expense_exists(marker: str, expenses: list) -> bool:
    for row in expenses:
        comment = row.get("comment") or ""
        if marker in comment:
            return True
    return False


def payment_exists(marker: str, payments: list) -> bool:
    for row in payments:
        note = row.get("note") or ""
        if marker in note:
            return True
    return False


def post_expense(payload: dict, expenses: list) -> None:
    marker = payload["comment"]
    if expense_exists(marker, expenses):
        print("skip expense", marker)
        return
    status, data = req("POST", "/api/expenses", payload)
    if status >= 400:
        raise RuntimeError(f"expense {marker}: {status} {data}")
    expenses.append(data)
    print("expense", data.get("id"), marker, payload["amount"])


def post_salary(payload: dict, payments: list) -> None:
    marker = payload["note"]
    if payment_exists(marker, payments):
        print("skip salary", marker)
        return
    status, data = req("POST", "/api/salary/payments", payload)
    if status >= 400:
        raise RuntimeError(f"salary {marker}: {status} {data}")
    payments.append(data)
    print("salary", data.get("id"), marker, payload["amount"])


def ensure_stas() -> int:
    status, data = req("GET", "/api/finance/imprest")
    assert status == 200
    for h in data.get("holders") or []:
        if "стас" in (h.get("name") or "").lower():
            return int(h["id"])
    status, created = req(
        "POST",
        "/api/finance/imprest/holders",
        {
            "name": "Стас",
            "role_note": "Учредитель / подотчёт",
            "opening_balance": 35000,
            "opening_balance_date": "2026-07-01",
            "is_active": True,
        },
    )
    if status >= 400:
        raise RuntimeError(f"create stas: {status} {created}")
    print("stas holder", created["id"], "balance", created.get("balance"))
    return int(created["id"])


def post_imprest_issue(holder_id: int, amount: float, move_date: str, marker: str) -> None:
    status, data = req(
        "POST",
        "/api/finance/imprest/movements",
        {
            "holder_id": holder_id,
            "move_date": move_date,
            "kind": "issue",
            "amount": amount,
            "comment": marker,
        },
    )
    if status >= 400:
        raise RuntimeError(f"imprest {marker}: {status} {data}")
    print("imprest", data.get("id"), marker, amount, "dup" if data.get("_duplicate") else "")


def main() -> None:
    login()
    wait_imprest()

    drivers = get_drivers()
    trof = ensure_driver(
        "Трофименко Кирилл Иванович", "trofimenko.payroll@reestrpro.local", drivers
    )
    mutaev = ensure_driver("Мутаев", "mutaev.payroll@reestrpro.local", drivers)
    sadaev = ensure_driver("Садаев", "sadaev.payroll@reestrpro.local", drivers)
    bukharov = ensure_driver("Бухаров", "bukharov.payroll@reestrpro.local", drivers)
    vadim = ensure_driver(
        "Вадим (выездной мастер)", "vadim.payroll@reestrpro.local", drivers
    )

    _, expenses = req("GET", "/api/expenses?from=2026-06-01&to=2026-07-31")
    _, payments = req("GET", "/api/salary/payments")
    expenses = expenses or []
    payments = payments or []

    # --- №1 salaries 01-15.06 ---
    post_salary(
        {
            "driver_id": trof,
            "type": "salary",
            "amount": 200250,
            "method": "cash",
            "period_start": "2026-06-01",
            "period_end": "2026-06-15",
            "note": "[cash-#1] ЗП 01.06-15.06 Трофименко",
        },
        payments,
    )
    post_salary(
        {
            "driver_id": mutaev,
            "type": "salary",
            "amount": 36750,
            "method": "cash",
            "period_start": "2026-06-01",
            "period_end": "2026-06-15",
            "note": "[cash-#1] ЗП 01.06-15.06 Мутаев",
        },
        payments,
    )
    post_salary(
        {
            "driver_id": sadaev,
            "type": "salary",
            "amount": 40750,
            "method": "cash",
            "period_start": "2026-06-01",
            "period_end": "2026-06-15",
            "note": "[cash-#1] ЗП 01.06-15.06 Садаев",
        },
        payments,
    )
    post_salary(
        {
            "driver_id": bukharov,
            "type": "salary",
            "amount": 28494,
            "method": "cash",
            "period_start": "2026-06-01",
            "period_end": "2026-06-15",
            "note": "[cash-#1] ЗП 01.06-15.06 Бухаров (43494-15000 налоги)",
        },
        payments,
    )

    # --- №2,3,7 Spartak wheels ---
    for n, date, amount in [
        (2, "2026-07-03", 25000),
        (3, "2026-07-03", 10000),
        (7, "2026-07-10", 10000),
    ]:
        post_expense(
            {
                "exp_date": date,
                "exp_type": "parts",
                "method": "cash",
                "amount": amount,
                "comment": f"[cash-#{n}] Возврат Спартаку: колёса (из своих)",
            },
            expenses,
        )

    # --- №4 accountant salary ---
    post_expense(
        {
            "exp_date": "2026-07-06",
            "exp_type": "salary_other",
            "method": "cash",
            "amount": 25000,
            "comment": "[cash-#4] ЗП бухгалтера наличка (аванс 10к был 26.06)",
        },
        expenses,
    )

    # --- №5 hotel ---
    post_expense(
        {
            "exp_date": "2026-07-07",
            "exp_type": "other",
            "method": "cash",
            "amount": 2600,
            "comment": "[cash-#5] Гостиница Руза (Арам+Спартак)",
        },
        expenses,
    )

    # --- №6 Stas imprest + Kirill fines ---
    stas_id = ensure_stas()
    post_imprest_issue(
        stas_id, 25000, "2026-07-09", "[cash-#6] Выдача под отчёт Стасу +25к (было 35к → 60к)"
    )
    post_expense(
        {
            "exp_date": "2026-07-09",
            "exp_type": "fine",
            "method": "cash",
            "amount": 10000,
            "driver_id": trof,
            "comment": "[cash-#6] Штрафы Кирилла (фары и др.)",
        },
        expenses,
    )

    # --- №8 Trofimenko + Vadim ---
    post_salary(
        {
            "driver_id": trof,
            "type": "salary",
            "amount": 169100,
            "method": "cash",
            "period_start": "2026-06-16",
            "period_end": "2026-06-30",
            "note": "[cash-#8] ЗП вахта 16.06-30.06 Трофименко",
        },
        payments,
    )
    post_salary(
        {
            "driver_id": vadim,
            "type": "salary",
            "amount": 7000,
            "method": "cash",
            "period_start": "2026-06-16",
            "period_end": "2026-06-30",
            "note": "[cash-#8] Выплата Вадим 7000",
        },
        payments,
    )

    # --- №9 shiny+taxi ---
    post_expense(
        {
            "exp_date": "2026-07-16",
            "exp_type": "repair",
            "method": "cash",
            "amount": 5000,
            "comment": "[cash-#9] Шинка + такси",
        },
        expenses,
    )

    # --- №10 ---
    post_salary(
        {
            "driver_id": sadaev,
            "type": "salary",
            "amount": 40750,
            "method": "cash",
            "period_start": "2026-06-16",
            "period_end": "2026-06-30",
            "note": "[cash-#10] ЗП вахта 16.06-30.06 Садаев",
        },
        payments,
    )
    post_salary(
        {
            "driver_id": mutaev,
            "type": "salary",
            "amount": 36350,
            "method": "cash",
            "period_start": "2026-06-16",
            "period_end": "2026-06-30",
            "note": "[cash-#10] ЗП вахта 16.06-30.06 Мутаев (43750-7400 зеркало Яковлев)",
        },
        payments,
    )
    post_expense(
        {
            "exp_date": "2026-07-18",
            "exp_type": "toll",
            "method": "cash",
            "amount": 40000,
            "comment": "[cash-#10] Платки наличка",
        },
        expenses,
    )
    post_expense(
        {
            "exp_date": "2026-07-18",
            "exp_type": "other",
            "method": "cash",
            "amount": 20350,
            "comment": "[cash-#10] ХОЛД: билет нового водителя — решение позже",
        },
        expenses,
    )

    # --- №11 accountant advance ---
    post_expense(
        {
            "exp_date": "2026-07-22",
            "exp_type": "salary_other",
            "method": "cash",
            "amount": 10000,
            "comment": "[cash-#11] Аванс бухгалтеру",
        },
        expenses,
    )

    # --- №12 ---
    post_expense(
        {
            "exp_date": "2026-07-22",
            "exp_type": "fine",
            "method": "cash",
            "amount": 40050,
            "comment": "[cash-#12] Штрафстоянка",
        },
        expenses,
    )
    post_expense(
        {
            "exp_date": "2026-07-22",
            "exp_type": "other",
            "method": "cash",
            "amount": 9950,
            "comment": "[cash-#12] Возврат Спартаку часть трат (гостиницы/платка/шинка); остаток долга был 4650",
        },
        expenses,
    )

    # --- №13 ---
    post_expense(
        {
            "exp_date": "2026-07-23",
            "exp_type": "toll",
            "method": "cash",
            "amount": 20000,
            "comment": "[cash-#13] Платка наличка",
        },
        expenses,
    )

    # --- №14 one row bank amount ---
    post_expense(
        {
            "exp_date": "2026-07-24",
            "exp_type": "other",
            "method": "cash",
            "amount": 48000,
            "comment": "[cash-#14] Запчасти 1912 + лента 1575 + такси 3226 + эвакуация 42050 (банк 48000)",
        },
        expenses,
    )

    # --- №15 ---
    post_expense(
        {
            "exp_date": "2026-07-25",
            "exp_type": "repair",
            "method": "cash",
            "amount": 8000,
            "comment": "[cash-#15] Возврат Спартаку (3000 шинка + 4650 остаток ≈7650, выдали 8000)",
        },
        expenses,
    )
    post_expense(
        {
            "exp_date": "2026-07-25",
            "exp_type": "fine",
            "method": "cash",
            "amount": 20000,
            "comment": "[cash-#15] Возврат Араму за ГАИ (из своих)",
        },
        expenses,
    )

    # --- Bank operating expenses (table 2), no fuel topups ---
    bank_ops = [
        ("2026-07-07", "platon", 10000, 'ООО "РТИТС" Платон'),
        ("2026-07-07", "repair", 20000, "Ермалович ремонт счёт 298"),
        ("2026-07-07", "repair", 40000, "Ермалович ремонт счёт 298"),
        ("2026-07-07", "repair", 161471, "Горбачев ремонт КПП счёт 96"),
        ("2026-07-13", "parts", 12620, 'ООО "Автозапчасти Наши" счёт 6341'),
        ("2026-07-14", "wash", 2800, "Зеленин мойка счёт 6720"),
        ("2026-07-14", "repair", 9550, 'ООО "Интайм" шиномонтаж счёт 1487'),
        ("2026-07-14", "parts", 12550, 'ООО "Макавто" счёт 500'),
        ("2026-07-14", "repair", 20000, "Ермалович ремонт счёт 395"),
        ("2026-07-14", "parts", 97100, 'ООО "Макавто" счёт 495'),
        ("2026-07-16", "parts", 32500, 'ООО "Интайм" автошина счёт 1824'),
        ("2026-07-17", "bank_fee", 387, "Сбер комиссия в другие банки"),
        ("2026-07-17", "bank_fee", 3521.35, "Сбер комиссия ЮЛ→ФЛ"),
        ("2026-07-17", "platon", 5000, 'ООО "РТИТС" Платон'),
        ("2026-07-17", "parts", 7400, "Яковлев запчасти АЯ00017174"),
        ("2026-07-17", "parts", 14840, "Яковлев запчасти АЯ00017252"),
        ("2026-07-17", "toll", 30000, "Автодор платные дороги"),
        ("2026-07-18", "bank_fee", 4810.75, "Сбер комиссия ЮЛ→ФЛ"),
        ("2026-07-19", "bank_fee", 3370, "СберБизнес Прайм"),
        ("2026-07-20", "parts", 16860, "Яковлев запчасти АЯ00017304"),
        ("2026-07-20", "parts", 23148, 'ООО "Автозапчасти Наши" счёт 6592'),
        ("2026-07-22", "parts", 23775, "Яковлев запчасти АЯ00017419"),
        ("2026-07-23", "parts", 31548, "Яковлев запчасти АЯ00017563"),
        ("2026-07-24", "parts", 4600, "Яковлев запчасти АЯ00017544"),
        ("2026-07-24", "platon", 10000, 'ООО "РТИТС" Платон'),
        ("2026-07-24", "toll", 50000, "Автодор платные дороги"),
    ]
    for date, exp_type, amount, title in bank_ops:
        marker = f"[bank-op-{date}-{amount}-{title[:40]}]"
        post_expense(
            {
                "exp_date": date,
                "exp_type": exp_type,
                "method": "noncash",
                "amount": amount,
                "comment": f"{marker} {title}",
            },
            expenses,
        )

    status, imprest = req("GET", "/api/finance/imprest")
    status2, cash = req("GET", "/api/finance/cash-summary")
    print("imprest", json.dumps(imprest, ensure_ascii=False, indent=2)[:1500])
    print("cash-summary", json.dumps(cash, ensure_ascii=False, indent=2))
    print("DONE")


if __name__ == "__main__":
    # bootstrap login without TOKEN for first call path
    TOKEN = "pending"
    main()

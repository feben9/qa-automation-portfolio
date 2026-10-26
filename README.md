# QA Automation Portfolio

Three small, runnable projects that show how I approach test automation. My day-to-day work is in private employer repositories. These use public practice systems and made-up data, so anyone can run them.

| Folder | What it shows | Stack |
|---|---|---|
| [`web-api/`](web-api) | UI and API test automation with page objects | Playwright, TypeScript |
| [`data-validation/`](data-validation) | Data-quality checks written in SQL | Python, SQLite, pytest |
| [`ai-eval/`](ai-eval) | Evaluating AI extraction output against source documents | Python, pytest |

All three run in GitHub Actions on every push ([`ci.yml`](.github/workflows/ci.yml)).

---

## 1. Web and API automation (`web-api/`)

UI tests run against [Sauce Demo](https://www.saucedemo.com) and API tests against the [Restful-Booker](https://restful-booker.herokuapp.com) API. Both are public practice systems.

- **Page objects** (`pages/`) keep selectors out of the tests. Locators use the site's test ids, not CSS paths.
- **The login tests** cover the happy path, a locked-out user, field validation, and redirection away from protected pages.
- **The checkout tests** check more than "it worked". They reconcile the money: the item total must equal the list prices, and item total plus tax must equal the total. The comparison is in cents, so floating-point noise can't hide an error.
- **The API tests** follow a booking through its whole lifecycle:
  - creating it, and checking that every field comes back unchanged;
  - finding it by name, exactly once;
  - confirming an update without a token is refused (403) and an update with a token persists;
  - deleting it, then confirming it's gone;
  - confirming bad credentials return no token.

  Each test creates its own data, so the tests can run in any order.

```bash
cd web-api
npm ci && npx playwright install chromium
npm test            # or: npm run test:ui / npm run test:api
```

## 2. Data validation with SQL (`data-validation/`)

A small remittance dataset (customers, transactions, settlements) with **defects planted on purpose**. Each check in [`dq/checks.py`](data-validation/dq/checks.py) is one SQL query that returns the offending records:

| Check | Catches |
|---|---|
| `duplicate_transaction` | The same transaction id recorded twice |
| `orphan_transaction_customer` | A transaction for a customer that doesn't exist (referential integrity) |
| `missing_amount`, `non_positive_amount` | Empty or negative amounts |
| `unsupported_currency` | Currencies outside the supported list |
| `settled_without_settlement` | A transaction marked settled with no settlement record |
| `orphan_settlement` | A settlement for a transaction that doesn't exist |
| `amount_mismatch` | Reconciliation: the amount or currency sent differs from what was settled |

The tests prove each check finds **exactly** the planted defects, with no misses and no false alarms. They also prove that a corrected copy of the data passes every check.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd data-validation
../.venv/bin/python -m pytest -q
../.venv/bin/python -m dq.checks data      # human-readable report
```

## 3. Evaluating AI output (`ai-eval/`)

An invoice-extraction model reads documents and returns fields (invoice number, vendor, date, total, currency). [`evaluator.py`](ai-eval/evaluator.py) asks three questions of every field:

1. **Is it correct?** It's compared with a hand-checked golden answer.
2. **Is it grounded?** The value has to appear in the source document. Numbers, dates in any common format, and currency codes are parsed from the text, so `18,800.00` matches `18800` and `15/09/2026` matches `2026-09-15`. A value found nowhere in the source counts as **fabricated**, however plausible it looks.
3. **Did it regress?** A field that was right in the baseline model and is wrong now is a regression.

A **release gate** combines the results: no fabrication, no regressions, and accuracy of at least 95%.

The recorded outputs contain realistic failure modes:
- **v1** invents a currency (`USD`) that appears nowhere on the receipt.
- **v2** fixes that, but takes on two new problems:
  - It picks the **subtotal** instead of the total. That value *is* in the document, so only the golden comparison catches it, not the fabrication check.
  - It adds "Ltd" to a vendor name. That looks plausible but isn't what the document says.

The gate blocks v2 and says why:

```
accuracy      18/20 (90%)
fabricated    ['inv-002.vendor']
regressions   ['inv-001.total', 'inv-002.vendor']
fixes         ['inv-004.currency']
GATE: FAIL
```

Everything runs offline with recorded outputs, so no API key is needed. Pointing it at a live model just means writing that model's responses in the same JSON shape.

```bash
cd ai-eval
../.venv/bin/python -m pytest -q
../.venv/bin/python evaluator.py outputs/model_v2.json --baseline outputs/model_v1.json
```

---

**About me:** I'm a QA lead with 4+ years of experience testing financial, regulatory and mobile systems. My day-to-day work includes:
- real-device mobile automation (Appium, WebdriverIO);
- Playwright and API testing;
- data validation with SQL;
- AI-assisted QA workflows.

I also hold an MSc in Data Science. [LinkedIn](https://www.linkedin.com/in/febentibebe/)

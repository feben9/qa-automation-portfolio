# QA Automation Portfolio

Four small, runnable projects that show how I approach test automation. My day-to-day work is in private employer repositories. These use public practice systems and made-up data, so anyone can run them.

| Folder | What it shows | Stack |
|---|---|---|
| [`web-api/`](web-api) | UI and API test automation with page objects | Playwright, TypeScript |
| [`data-validation/`](data-validation) | Data-quality checks written in SQL | Python, SQLite, pytest |
| [`ai-eval/`](ai-eval) | Evaluating AI extraction output against source documents | Python, pytest |
| [`performance/`](performance) | Load, stress and spike tests against a small payments API | k6, Node |

All four run in GitHub Actions on every push ([`ci.yml`](.github/workflows/ci.yml)). The heavier stress and spike tests run on demand ([`performance-manual.yml`](.github/workflows/performance-manual.yml)).

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

## 4. Performance testing (`performance/`)

A tiny remittance API ([`api/server.js`](performance/api/server.js), plain Node, in-memory) is the target, so all load goes to localhost and never to someone else's site. It has `GET /health`, `GET /rates` (fast), `POST /transfers` (validates, does some work), `GET /transfers/:id` and `GET /reports/daily`.

**The deliberate bottleneck:** the daily report holds a shared worker pool. Each concurrent report adds delay, and past 40 at once it answers 503. One report takes about 65 ms, which is fine. Sixty at once is a different story. The tests are built to show that.

Each test type answers a different question:

| Test | Question | Shape |
|---|---|---|
| [`smoke.js`](performance/tests/smoke.js) | Does every endpoint answer with the right status and body? | 1 user, 30 s |
| [`load.js`](performance/tests/load.js) | Does a normal busy day stay inside budget? | Ramp to 40 users, hold, plus 3 report users |
| [`stress.js`](performance/tests/stress.js) | Where does it break, and what breaks first? | Arrival rate up to 240/s, reports up to 60 users |
| [`spike.js`](performance/tests/spike.js) | Does it survive a sudden rush and recover? | 5 to 150 users in 3 s, then back |

- **Thresholds, and why.** Every request is tagged with an endpoint name, so each endpoint gets its own budget (`http_req_duration{name:rates}` and so on). Normal endpoints must stay under p(95) 300 ms with under 1% failed requests, because a slow rate lookup is felt by every customer. The report gets a looser 600 ms, because it is slow by nature. A failed check counts as a business error, and the budget for those is zero.
- **Stress thresholds document the break.** They are written the other way round for the report: `p(95)>600` and `report_degraded>10%` must hold, so the run *passes* only if the bottleneck is visible. The same run asserts that `/rates` and `/transfers` stay under 300 ms, which proves one slow endpoint doesn't drag down the rest.
- **Custom metrics:** a `Trend` for transfer creation time, a `Counter` for business errors, and a `Rate` for degraded reports. Each test writes a JSON and a text summary to `performance/results/`.
- **CI** runs smoke and load on every push (about 2 minutes) and uploads the summaries. Stress and spike are manual, since they are meant to push the API over.

Real results from a local run (k6 1.1.0):

```
load    93 req/s, 0.00% failed, 8,560 requests
          create_transfer p(95)=5.06ms   rates p(95)=0.34ms   daily_report p(95)=90.7ms     all thresholds passed
stress  daily_report   p(95)=989.7ms  (max 1.04s)   report_degraded 34%   4 requests shed with 503
        rates          p(95)=0.40ms   create_transfer p(95)=3.4ms   (unaffected)
```

Under stress the report went from 65 ms to almost a second while everything else stayed in the low milliseconds. That is the finding a real report would raise: this endpoint needs its own capacity or a queue.

```bash
node performance/api/server.js &                       # PORT env, default 3333
cd performance
k6 run tests/smoke.js                                  # also: load.js, stress.js, spike.js
DURATION_SCALE=3 VU_SCALE=2 k6 run tests/load.js       # longer and heavier locally
```

---

**About me:** I'm a QA lead with 4+ years of experience testing financial, regulatory and mobile systems. My day-to-day work includes:
- real-device mobile automation (Appium, WebdriverIO);
- Playwright and API testing;
- performance testing with k6;
- data validation with SQL;
- AI-assisted QA workflows.

I also hold an MSc in Data Science. [LinkedIn](https://www.linkedin.com/in/febentibebe/)

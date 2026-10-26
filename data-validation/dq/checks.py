"""Data-quality checks for a small remittance dataset, written in SQL.

The CSVs are loaded into an in-memory SQLite database and each check is one
query that returns the offending records. A check that returns nothing passes.

Run as a script for a report:  python -m dq.checks data/
"""
from __future__ import annotations

import csv
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

SUPPORTED_CURRENCIES = ("ETB", "KES", "NGN", "AED")

TABLES = {
    "customers": "customer_id TEXT, name TEXT, country TEXT, created_at TEXT",
    "transactions": "txn_id TEXT, customer_id TEXT, amount REAL, currency TEXT, status TEXT, created_at TEXT",
    "settlements": "settlement_id TEXT, txn_id TEXT, settled_amount REAL, currency TEXT, settled_at TEXT",
}


@dataclass(frozen=True)
class Finding:
    check: str
    key: str
    detail: str


def load(data_dir: Path) -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    for table, columns in TABLES.items():
        db.execute(f"CREATE TABLE {table} ({columns})")
        with open(data_dir / f"{table}.csv", newline="") as f:
            rows = list(csv.DictReader(f))
        if rows:
            names = list(rows[0])
            marks = ", ".join("?" for _ in names)
            # Empty CSV cells become NULL, not empty strings.
            values = [[r[n] if r[n] != "" else None for n in names] for r in rows]
            db.executemany(f"INSERT INTO {table} ({', '.join(names)}) VALUES ({marks})", values)
    return db


# Each check: (name, SQL returning (key, detail) rows).
CHECKS: list[tuple[str, str]] = [
    (
        "duplicate_transaction",
        """SELECT txn_id, 'appears ' || COUNT(*) || ' times'
           FROM transactions GROUP BY txn_id HAVING COUNT(*) > 1""",
    ),
    (
        "orphan_transaction_customer",
        """SELECT t.txn_id, 'unknown customer ' || t.customer_id
           FROM transactions t LEFT JOIN customers c ON c.customer_id = t.customer_id
           WHERE c.customer_id IS NULL""",
    ),
    (
        "missing_amount",
        "SELECT txn_id, 'amount is empty' FROM transactions WHERE amount IS NULL",
    ),
    (
        "non_positive_amount",
        "SELECT txn_id, 'amount ' || amount FROM transactions WHERE amount <= 0",
    ),
    (
        "unsupported_currency",
        f"""SELECT txn_id, 'currency ' || currency FROM transactions
            WHERE currency NOT IN ({', '.join(repr(c) for c in SUPPORTED_CURRENCIES)})""",
    ),
    (
        "settled_without_settlement",
        """SELECT DISTINCT t.txn_id, 'status settled but no settlement row'
           FROM transactions t LEFT JOIN settlements s ON s.txn_id = t.txn_id
           WHERE t.status = 'settled' AND s.txn_id IS NULL""",
    ),
    (
        "orphan_settlement",
        """SELECT s.settlement_id, 'settles unknown transaction ' || s.txn_id
           FROM settlements s LEFT JOIN transactions t ON t.txn_id = s.txn_id
           WHERE t.txn_id IS NULL""",
    ),
    (
        "amount_mismatch",
        # Compare in cents so float noise can't hide or invent a difference.
        """SELECT DISTINCT t.txn_id,
                  'sent ' || IFNULL(t.amount, 'NULL') || ' ' || t.currency ||
                  ', settled ' || s.settled_amount || ' ' || s.currency
           FROM transactions t JOIN settlements s ON s.txn_id = t.txn_id
           WHERE t.amount IS NULL
              OR ROUND(t.amount * 100) <> ROUND(s.settled_amount * 100)
              OR t.currency <> s.currency""",
    ),
]


def run_all(db: sqlite3.Connection) -> list[Finding]:
    findings = []
    for name, sql in CHECKS:
        for key, detail in db.execute(sql):
            findings.append(Finding(name, key, detail))
    return findings


def main(argv: list[str]) -> int:
    data_dir = Path(argv[1] if len(argv) > 1 else "data")
    findings = run_all(load(data_dir))
    for name, _ in CHECKS:
        hits = [f for f in findings if f.check == name]
        status = "PASS" if not hits else f"FAIL ({len(hits)})"
        print(f"{status:10} {name}")
        for f in hits:
            print(f"           - {f.key}: {f.detail}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

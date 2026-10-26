"""The sample data has known defects planted in it. These tests prove each
check finds exactly those defects (no misses, no false alarms), and that a
corrected copy of the data passes every check."""
import csv
import shutil
from pathlib import Path

import pytest

from dq.checks import CHECKS, load, run_all

DATA = Path(__file__).resolve().parent.parent / "data"

# check name -> keys it must report, and nothing else
EXPECTED = {
    "duplicate_transaction": {"T1006"},
    "orphan_transaction_customer": {"T1007"},
    "missing_amount": {"T1009"},
    "non_positive_amount": {"T1008"},
    "unsupported_currency": {"T1011"},
    "settled_without_settlement": set(),
    "orphan_settlement": {"S5011"},
    "amount_mismatch": {"T1004", "T1009"},
}


@pytest.fixture(scope="module")
def findings():
    return run_all(load(DATA))


def test_every_check_has_an_expectation():
    assert {name for name, _ in CHECKS} == set(EXPECTED)


@pytest.mark.parametrize("check", sorted(EXPECTED))
def test_check_finds_exactly_the_planted_defects(findings, check):
    found = {f.key for f in findings if f.check == check}
    assert found == EXPECTED[check]


def _rewrite(path: Path, fix):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    fieldnames = list(rows[0])
    rows = fix(rows)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def test_corrected_data_passes_every_check(tmp_path):
    for name in ("customers", "transactions", "settlements"):
        shutil.copy(DATA / f"{name}.csv", tmp_path)

    def fix_transactions(rows):
        seen, out = set(), []
        for r in rows:
            if r["txn_id"] in seen:
                continue
            seen.add(r["txn_id"])
            if r["txn_id"] == "T1007":
                r["customer_id"] = "C001"
            if r["txn_id"] == "T1008":
                r["amount"] = "25.00"
            if r["txn_id"] == "T1009":
                r["amount"] = "60.00"
            if r["txn_id"] == "T1011":
                r["currency"] = "AED"
            out.append(r)
        return out

    def fix_settlements(rows):
        out = []
        for r in rows:
            if r["txn_id"] == "T1099":
                continue
            if r["txn_id"] == "T1004":
                r["settled_amount"] = "15000.00"
            if r["txn_id"] == "T1008":
                r["settled_amount"] = "25.00"
            if r["txn_id"] == "T1011":
                r["currency"] = "AED"
            out.append(r)
        return out

    _rewrite(tmp_path / "transactions.csv", fix_transactions)
    _rewrite(tmp_path / "settlements.csv", fix_settlements)

    assert run_all(load(tmp_path)) == []

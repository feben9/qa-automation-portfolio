"""Tests for the evaluator itself. The recorded model outputs contain planted
problems; these tests prove the evaluator catches each one and that the
release gate makes the right call."""
import json
from pathlib import Path

import pytest

from evaluator import ROOT, evaluate, is_grounded, release_gate, source_facts

GOLDEN = json.loads((ROOT / "golden" / "expected.json").read_text())
V1 = json.loads((ROOT / "outputs" / "model_v1.json").read_text())
V2 = json.loads((ROOT / "outputs" / "model_v2.json").read_text())
SOURCES = ROOT / "sources"


def test_golden_answers_are_themselves_grounded():
    # Guards the test data: a golden answer missing from its source is a typo.
    for doc_id, fields in GOLDEN.items():
        facts = source_facts((SOURCES / f"{doc_id}.txt").read_text())
        for name, value in fields.items():
            assert is_grounded(name, value, facts), f"{doc_id}.{name}"


def test_perfect_output_passes_the_gate():
    report = evaluate(GOLDEN, GOLDEN, SOURCES, baseline=GOLDEN)
    assert report.accuracy == 1.0
    assert release_gate(report) == (True, [])


def test_v1_invented_currency_is_flagged_as_fabricated():
    report = evaluate(V1, GOLDEN, SOURCES)
    assert report.wrong == ["inv-004.currency"]
    assert report.fabricated == ["inv-004.currency"]  # "USD" is nowhere in the receipt


def test_v2_against_v1_baseline():
    report = evaluate(V2, GOLDEN, SOURCES, baseline=V1)
    # Fixed the currency that v1 invented.
    assert report.fixes == ["inv-004.currency"]
    # Picked the subtotal instead of the total: wrong but grounded, so only the
    # golden comparison catches it, not the fabrication check.
    assert "inv-001.total" in report.regressions
    assert "inv-001.total" not in report.fabricated
    # Added "Ltd" to a vendor name: plausible, but not what the document says.
    assert report.fabricated == ["inv-002.vendor"]
    assert set(report.wrong) == {"inv-001.total", "inv-002.vendor"}


def test_gate_blocks_v2_and_says_why():
    ok, reasons = release_gate(evaluate(V2, GOLDEN, SOURCES, baseline=V1))
    assert not ok
    assert any("fabricated" in r for r in reasons)
    assert any("regressions" in r for r in reasons)


@pytest.mark.parametrize(
    "text, field_name, value, grounded",
    [
        ("Total: ETB 18,800.00", "total", 18800, True),
        ("Total: ETB 18,800.00", "total", 18000, False),
        ("Date of issue: 15/09/2026", "date", "2026-09-15", True),
        ("21 Sep 2026", "date", "2026-09-21", True),
        ("Sheba Catering", "vendor", "sheba  catering", True),
        ("Sheba Catering", "vendor", "Sheba Catering PLC", False),
        ("anything", "vendor", None, True),
    ],
)
def test_grounding_rules(text, field_name, value, grounded):
    assert is_grounded(field_name, value, source_facts(text)) is grounded

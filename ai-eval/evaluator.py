"""Evaluate an invoice-extraction model's output against source documents.

Three questions per extracted field:
  1. Correct?    It matches the golden (hand-checked) answer.
  2. Grounded?   The value actually appears in the source document. A value
                 that appears nowhere in the source is treated as fabricated,
                 whether or not it happens to look plausible.
  3. Regressed?  It was correct in the baseline model and is wrong now.

A release gate turns those into a pass/fail decision.

Run as a script:  python evaluator.py outputs/model_v2.json --baseline outputs/model_v1.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIELDS = ("invoice_number", "vendor", "date", "total", "currency")
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d %B %Y", "%d %b %Y")


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def source_facts(text: str) -> dict[str, set]:
    """Every number, date and currency code that appears in a document."""
    numbers = {float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    dates = set()
    for candidate in re.findall(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}|\d{1,2} [A-Za-z]+ \d{4}", text):
        for fmt in DATE_FORMATS:
            try:
                dates.add(datetime.strptime(candidate, fmt).date().isoformat())
                break
            except ValueError:
                pass
    currencies = set(re.findall(r"\b[A-Z]{3}\b", text))
    return {"numbers": numbers, "dates": dates, "currencies": currencies, "text": {_norm_text(text)}}


def is_grounded(field_name: str, value, facts: dict[str, set]) -> bool:
    if value is None:
        return True  # "not found" is honest, not fabricated
    if field_name == "total":
        return float(value) in facts["numbers"]
    if field_name == "date":
        return value in facts["dates"]
    if field_name == "currency":
        return value in facts["currencies"]
    return _norm_text(str(value)) in next(iter(facts["text"]))


def is_correct(field_name: str, value, expected) -> bool:
    if field_name == "total":
        return value is not None and round(float(value) * 100) == round(float(expected) * 100)
    return value == expected


@dataclass
class Report:
    total_fields: int = 0
    correct: int = 0
    wrong: list[str] = field(default_factory=list)
    fabricated: list[str] = field(default_factory=list)
    regressions: list[str] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return self.correct / self.total_fields if self.total_fields else 0.0


def evaluate(outputs: dict, golden: dict, sources_dir: Path, baseline: dict | None = None) -> Report:
    report = Report()
    for doc_id, expected in golden.items():
        facts = source_facts((sources_dir / f"{doc_id}.txt").read_text())
        got = outputs.get(doc_id, {})
        for name in FIELDS:
            key = f"{doc_id}.{name}"
            value = got.get(name)
            report.total_fields += 1
            correct = is_correct(name, value, expected[name])
            if correct:
                report.correct += 1
            else:
                report.wrong.append(key)
            if not is_grounded(name, value, facts):
                report.fabricated.append(key)
            if baseline is not None:
                was_correct = is_correct(name, baseline.get(doc_id, {}).get(name), expected[name])
                if was_correct and not correct:
                    report.regressions.append(key)
                elif correct and not was_correct:
                    report.fixes.append(key)
    return report


def release_gate(report: Report, min_accuracy: float = 0.95) -> tuple[bool, list[str]]:
    """No fabrication and no regression are hard rules; accuracy has a floor."""
    reasons = []
    if report.fabricated:
        reasons.append(f"fabricated values: {', '.join(report.fabricated)}")
    if report.regressions:
        reasons.append(f"regressions vs baseline: {', '.join(report.regressions)}")
    if report.accuracy < min_accuracy:
        reasons.append(f"accuracy {report.accuracy:.0%} below {min_accuracy:.0%}")
    return (not reasons, reasons)


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("outputs", type=Path)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()

    golden = _load(ROOT / "golden" / "expected.json")
    baseline = _load(args.baseline) if args.baseline else None
    report = evaluate(_load(args.outputs), golden, ROOT / "sources", baseline)

    print(f"accuracy      {report.correct}/{report.total_fields} ({report.accuracy:.0%})")
    print(f"wrong         {report.wrong or '-'}")
    print(f"fabricated    {report.fabricated or '-'}")
    if baseline is not None:
        print(f"regressions   {report.regressions or '-'}")
        print(f"fixes         {report.fixes or '-'}")
    ok, reasons = release_gate(report)
    print("GATE: PASS" if ok else "GATE: FAIL\n  " + "\n  ".join(reasons))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

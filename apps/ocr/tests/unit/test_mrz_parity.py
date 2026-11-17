"""
Parity tests for passport MRZ extraction.

`tests/fixtures/mrz_parity.json` records what the service returned for these inputs while it
still used the third-party `mrz` package: OCR text of the passport fixtures, ICAO specimen and
edge-case MRZs, and generated and OCR-corrupted MRZs. The in-repo parser must return the same
fields and validity. Intentional differences are covered in test_parser.py and test_mrz.py.
"""

import dataclasses
import json
from pathlib import Path

import pytest

from ocr_service.services.parser import extract_passport_fields, parse_mrz

_FIXTURE = Path(__file__).parent.parent / "fixtures" / "mrz_parity.json"
_ROWS = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_FUNCTIONS = {"extract_passport_fields": extract_passport_fields, "parse_mrz": parse_mrz}


def test_fixture_covers_valid_and_invalid_inputs():
    assert len(_ROWS) >= 90
    assert any(row["valid"] for row in _ROWS)
    assert any(not row["valid"] for row in _ROWS)


@pytest.mark.parametrize("row", _ROWS, ids=[row["name"] for row in _ROWS])
def test_matches_recorded_output(row):
    data, valid = _FUNCTIONS[row["function"]](row["text"])

    assert dataclasses.asdict(data) == row["data"]
    assert valid is row["valid"]

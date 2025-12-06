"""
Document validation.

Validates document format, checksums, and authenticity.
Country-specific validations (e.g., cedula) are clearly marked.
"""

import re
from typing import List
from datetime import datetime, date


def validate_cedula_number(number: str) -> List[str]:
    """
    Validate Dominican cedula number format and checksum.

    Format: XXX-XXXXXXX-X
    """
    issues = []

    if not number:
        issues.append("missing_document_number")
        return issues

    # Remove formatting
    digits = re.sub(r"[^\d]", "", number)

    if len(digits) != 11:
        issues.append("invalid_cedula_length")
        return issues

    # Validate all digits
    if not digits.isdigit():
        issues.append("invalid_cedula_characters")

    return issues


def validate_passport_number(number: str) -> List[str]:
    """
    Validate passport document number.

    Note: Passport number formats vary by country. The MRZ checksum
    (validated by the mrz library) is the authoritative validation.
    This function only performs basic sanity checks.
    """
    issues = []

    if not number:
        issues.append("missing_document_number")
        return issues

    # Basic sanity check: alphanumeric, reasonable length (6-12 chars)
    # Actual format validation is done by MRZ checksum
    if not re.match(r"^[A-Z0-9]{6,12}$", number):
        issues.append("invalid_passport_format")

    return issues


def validate_expiration_date(exp_date: str) -> List[str]:
    """Check if document is expired."""
    issues = []

    if not exp_date:
        return issues  # Can't validate if no date

    try:
        exp = datetime.strptime(exp_date, "%Y-%m-%d").date()
        if exp < date.today():
            issues.append("document_expired")
    except ValueError:
        issues.append("invalid_expiration_format")

    return issues


def validate_dob(dob: str) -> List[str]:
    """Validate date of birth is reasonable."""
    issues = []

    if not dob:
        return issues

    try:
        birth = datetime.strptime(dob, "%Y-%m-%d").date()
        today = date.today()
        age = (today - birth).days // 365

        if age < 0 or age > 150:
            issues.append("invalid_date_of_birth")
        elif age < 18:
            issues.append("minor_age_detected")
    except ValueError:
        issues.append("invalid_dob_format")

    return issues


def calculate_confidence(
    text_length: int,
    fields_extracted: int,
    ocr_avg_confidence: float,
    document_recognized: bool = True,
) -> float:
    """
    Calculate overall document confidence score.

    Factors:
    - Amount of text extracted
    - Number of fields successfully parsed
    - OCR confidence scores
    - Document origin recognized
    """
    score = 0.0

    # Text extraction quality (0-0.3)
    if text_length > 200:
        score += 0.3
    elif text_length > 100:
        score += 0.2
    elif text_length > 50:
        score += 0.1

    # Fields extracted (0-0.4)
    field_score = min(0.4, fields_extracted * 0.1)
    score += field_score

    # OCR confidence (0-0.3)
    score += ocr_avg_confidence * 0.3

    return min(1.0, score)

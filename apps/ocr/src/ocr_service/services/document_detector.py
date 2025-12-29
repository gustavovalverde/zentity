"""
Document type detection from OCR text.

Identifies identity document types (passport, national ID, driver's license)
based on text markers and patterns. Supports international documents.
"""

import re
from enum import Enum


class DocumentType(str, Enum):
    PASSPORT = "passport"
    NATIONAL_ID = "national_id"  # Generic national ID (cedula, DNI, etc.)
    DRIVERS_LICENSE = "drivers_license"
    UNKNOWN = "unknown"


# Detection patterns for each document type (international)
DOCUMENT_MARKERS = {
    DocumentType.NATIONAL_ID: [
        # Generic national ID patterns
        r"NATIONAL\s+ID",
        r"IDENTITY\s+CARD",
        r"ID\s+CARD",
        # Spanish-speaking countries
        r"CÉDULA\s+DE\s+IDENTIDAD",
        r"CEDULA\s+DE\s+IDENTIDAD",
        r"DOCUMENTO\s+NACIONAL",
        r"DNI",
        # Dominican Republic specific
        r"JUNTA\s+CENTRAL\s+ELECTORAL",
        r"JCE",
        # Common ID number formats
        r"\d{3}[-\s]?\d{7}[-\s]?\d{1}",  # Dominican cedula format
        r"\d{8}[A-Z]",  # Spanish DNI format
    ],
    DocumentType.PASSPORT: [
        r"PASAPORTE",
        r"PASSPORT",
        r"REISEPASS",  # German
        r"PASSEPORT",  # French
        r"P<[A-Z]{3}",  # MRZ indicator for any passport
        r"TIPO\s*/?\s*TYPE\s*P",
    ],
    DocumentType.DRIVERS_LICENSE: [
        r"LICENCIA\s+DE\s+CONDUCIR",
        r"DRIVER.*LICENSE",
        r"DRIVING\s+LICEN[CS]E",
        r"PERMIS\s+DE\s+CONDUIRE",  # French
        r"FÜHRERSCHEIN",  # German
        r"CATEGORÍA",
        r"CATEGORY",
    ],
}

# Pre-compile patterns at module load for O(1) matching
_COMPILED_PATTERNS: dict[DocumentType, list[re.Pattern]] = {
    doc_type: [re.compile(p, re.IGNORECASE) for p in patterns]
    for doc_type, patterns in DOCUMENT_MARKERS.items()
}

# Pre-compile fast-path MRZ pattern
_MRZ_PASSPORT_PATTERN = re.compile(r"P<[A-Z]{3}", re.IGNORECASE)


def detect_document_type(text: str) -> tuple[DocumentType, float]:
    """
    Detect document type from OCR text.

    Supports international documents including passports,
    national IDs, and driver's licenses.

    Returns:
        Tuple of (DocumentType, confidence_score)
    """
    text_upper = text.upper()

    # Fast path: a TD3 MRZ line starting with "P<" is a strong passport signal.
    # This avoids tie-break issues when only the MRZ region is OCR'd.
    if _MRZ_PASSPORT_PATTERN.search(text_upper):
        return DocumentType.PASSPORT, 1.0

    scores = {
        DocumentType.NATIONAL_ID: 0,
        DocumentType.PASSPORT: 0,
        DocumentType.DRIVERS_LICENSE: 0,
    }

    # Count matches for each document type using pre-compiled patterns
    for doc_type, compiled_patterns in _COMPILED_PATTERNS.items():
        for pattern in compiled_patterns:
            if pattern.search(text_upper):
                scores[doc_type] += 1

    # Find highest scoring type
    max_type = max(scores, key=scores.get)
    max_score = scores[max_type]

    if max_score == 0:
        return DocumentType.UNKNOWN, 0.0

    # Calculate confidence: ratio of matched patterns to total patterns
    confidence = max_score / len(DOCUMENT_MARKERS[max_type])

    return max_type, confidence

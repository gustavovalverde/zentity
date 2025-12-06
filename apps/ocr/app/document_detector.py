"""
Document type detection from OCR text.

Identifies Dominican Republic document types based on
text markers and patterns.
"""

from enum import Enum
from typing import Tuple
import re


class DocumentType(str, Enum):
    PASSPORT = "passport"
    CEDULA = "cedula"
    DRIVERS_LICENSE = "drivers_license"
    UNKNOWN = "unknown"


# Detection patterns for each document type
DOCUMENT_MARKERS = {
    DocumentType.CEDULA: [
        r"JUNTA\s+CENTRAL\s+ELECTORAL",
        r"CÉDULA\s+DE\s+IDENTIDAD",
        r"CEDULA\s+DE\s+IDENTIDAD",
        r"JCE",
        r"\d{3}[-\s]?\d{7}[-\s]?\d{1}",  # Cedula number format
    ],
    DocumentType.PASSPORT: [
        r"PASAPORTE",
        r"PASSPORT",
        r"P<DOM",  # MRZ indicator for Dominican passport
        r"DIRECCIÓN\s+GENERAL\s+DE\s+PASAPORTES",
        r"TIPO\s*/?\s*TYPE\s*P",
    ],
    DocumentType.DRIVERS_LICENSE: [
        r"LICENCIA\s+DE\s+CONDUCIR",
        r"DIRECCIÓN\s+GENERAL\s+DE\s+TRÁNSITO",
        r"INTRANT",
        r"CATEGORÍA",
        r"DRIVER.*LICENSE",
    ],
}

# Dominican Republic authenticity markers
DR_MARKERS = [
    r"REPÚBLICA\s+DOMINICANA",
    r"REPUBLICA\s+DOMINICANA",
    r"REP\.?\s*DOM\.?",
    r"DOMINICAN\s+REPUBLIC",
    r"DOM(?=\s|<|$)",  # DOM country code
]


def detect_document_type(text: str) -> Tuple[DocumentType, float]:
    """
    Detect document type from OCR text.

    Returns:
        Tuple of (DocumentType, confidence_score)
    """
    text_upper = text.upper()

    scores = {
        DocumentType.CEDULA: 0,
        DocumentType.PASSPORT: 0,
        DocumentType.DRIVERS_LICENSE: 0,
    }

    # Count matches for each document type
    for doc_type, patterns in DOCUMENT_MARKERS.items():
        for pattern in patterns:
            if re.search(pattern, text_upper, re.IGNORECASE):
                scores[doc_type] += 1

    # Find highest scoring type
    max_type = max(scores, key=scores.get)
    max_score = scores[max_type]

    if max_score == 0:
        return DocumentType.UNKNOWN, 0.0

    # Calculate confidence based on number of matches
    total_patterns = len(DOCUMENT_MARKERS[max_type])
    confidence = min(1.0, max_score / max(1, total_patterns - 1))

    return max_type, confidence


def is_dr_document(text: str) -> Tuple[bool, float]:
    """
    Check if document appears to be from Dominican Republic.

    Returns:
        Tuple of (is_dr, confidence_score)
    """
    text_upper = text.upper()
    matches = 0

    for pattern in DR_MARKERS:
        if re.search(pattern, text_upper, re.IGNORECASE):
            matches += 1

    if matches == 0:
        return False, 0.0

    confidence = min(1.0, matches / 2)  # 2+ matches = high confidence
    return True, confidence

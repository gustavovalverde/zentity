"""
Document field extraction using regex patterns.

Supports:
- National IDs (cedula, DNI, etc.)
- Passports with MRZ parsing (any country)
- Driver's Licenses

Uses:
- python-stdnum: Document number formatting
- iso3166: Country code lookups
- mrz: Passport MRZ parsing (ICAO 9303)
"""

import re
from dataclasses import dataclass

import iso3166
from mrz.base.countries_ops import get_country as mrz_get_country
from mrz.base.countries_ops import is_code
from mrz.checker.td3 import TD3CodeChecker
from stdnum.do import cedula as do_cedula
from stdnum.exceptions import ValidationError


@dataclass
class ExtractedData:
    full_name: str | None = None
    first_name: str | None = None  # Nombres
    last_name: str | None = None  # Apellidos
    document_number: str | None = None
    date_of_birth: str | None = None  # YYYY-MM-DD
    expiration_date: str | None = None  # YYYY-MM-DD
    nationality: str | None = None  # Full country name
    nationality_code: str | None = None  # ISO 3166-1 alpha-3 code
    issuing_country: str | None = None  # Full issuing country name
    issuing_country_code: str | None = None  # ISO 3166-1 alpha-3 issuing country code
    gender: str | None = None


# Common OCR character confusions in MRZ
OCR_SUBSTITUTIONS = [
    ("0", "O"),  # Zero ↔ Letter O (most common)
    ("1", "I"),  # One ↔ Letter I
    ("5", "S"),  # Five ↔ Letter S
    ("8", "B"),  # Eight ↔ Letter B
    ("2", "Z"),  # Two ↔ Letter Z
]


def correct_country_code(code: str) -> tuple[str, bool]:
    """
    Attempt to correct OCR errors in country code using mrz library validation.

    Returns:
        tuple: (corrected_code, was_corrected)
    """
    if is_code(code):
        return code, False  # Already valid

    # Try single character substitutions
    for wrong, right in OCR_SUBSTITUTIONS:
        # Try replacing wrong with right
        corrected = code.replace(wrong, right)
        if corrected != code and is_code(corrected):
            return corrected, True

        # Try the reverse (right with wrong) - in case OCR read letter as digit
        corrected = code.replace(right, wrong)
        if corrected != code and is_code(corrected):
            return corrected, True

    return code, False  # Could not correct


# =============================================================================
# National ID Extraction Patterns
# =============================================================================

# Stop words regex - marks the end of name fields in OCR text.
# Used to split extracted names from subsequent label text that may appear
# on the same line due to OCR layout detection.
FIRST_NAME_STOP_WORDS = r"\s+(?:APELLIDO|SURNAME|FECHA|DATE|SEXO|SEX|NACIMIENTO|BIRTH|VENCE|EXPIR)"
LAST_NAME_STOP_WORDS = r"\s+(?:NOMBRE|NAME|FECHA|DATE|SEXO|SEX|NACIMIENTO|BIRTH|VENCE|EXPIR)"

# Patterns for extracting fields from national ID documents.
# Order matters: country-specific patterns are tried first (fewer false positives),
# then generic fallback patterns. First match wins.
NATIONAL_ID_PATTERNS = {
    # Document number patterns - ordered by specificity (most specific first)
    "document_number": [
        r"\b(\d{3}[-\s]?\d{7}[-\s]?\d{1})\b",  # Dominican cedula: XXX-XXXXXXX-X
        r"\b(\d{8}[A-Z])\b",  # Spanish DNI: 12345678A
        r"\b([A-Z]\d{7}[A-Z])\b",  # Mexican INE: A1234567B
        r"\b(\d{9,12})\b",  # Generic fallback: 9-12 digit ID (higher false positive rate)
    ],
    # Name patterns (multilingual)
    "first_name": [
        r"(?:NOMBRE[S]?\s*[:.]?\s*)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)",  # Spanish
        r"(?:GIVEN\s*NAME[S]?\s*[:.]?\s*)([A-Z][A-Z\s]+)",  # English
        r"(?:FIRST\s*NAME\s*[:.]?\s*)([A-Z][A-Z\s]+)",  # English alt
        # French (with accented characters)
        r"(?:PRÉNOM[S]?\s*[:.]?\s*)([A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑ][A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑ\s]+)",
    ],
    "last_name": [
        r"(?:APELLIDO[S]?\s*[:.]?\s*)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)",  # Spanish
        r"(?:SURNAME\s*[:.]?\s*)([A-Z][A-Z\s]+)",  # English
        r"(?:LAST\s*NAME\s*[:.]?\s*)([A-Z][A-Z\s]+)",  # English alt
        r"(?:NOM\s*[:.]?\s*)([A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑ][A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸÑ\s]+)",  # French
    ],
    # Date patterns (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)
    "date_of_birth": [
        r"(?:FECHA\s*(?:DE\s*)?NAC(?:IMIENTO)?\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # Spanish
        r"(?:DATE\s*OF\s*BIRTH\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # English
        r"(?:DOB\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # Abbreviated
        r"(?:BORN\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # Alternative
    ],
    "expiration_date": [
        r"(?:VENCE|EXPIRA(?:CION)?|VALIDO?\s*HASTA)\s*[:.]?\s*(\d{2}[/-]\d{2}[/-]\d{4})",  # Spanish
        r"(?:EXPIR(?:Y|ES|ATION)?\s*(?:DATE)?\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # English
        r"(?:VALID\s*(?:UNTIL|THRU|TO)\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",  # Alternative
    ],
    # Gender
    "gender": [
        r"(?:SEXO\s*[:.]?\s*)([MF])",  # Spanish
        r"(?:SEX\s*[:.]?\s*)([MF])",  # English
        r"(?:GENDER\s*[:.]?\s*)([MF])",  # Alternative
    ],
}

# Country detection patterns
COUNTRY_MARKERS = {
    "DOM": [r"REPÚBLICA\s+DOMINICANA", r"REPUBLICA\s+DOMINICANA", r"REP\.?\s*DOM", r"DOMINICAN"],
    "ESP": [r"ESPAÑA", r"SPAIN", r"REINO\s+DE\s+ESPAÑA"],
    "MEX": [r"MÉXICO", r"MEXICO", r"ESTADOS\s+UNIDOS\s+MEXICANOS"],
    "USA": [r"UNITED\s+STATES", r"U\.?S\.?A\.?"],
    "FRA": [r"RÉPUBLIQUE\s+FRANÇAISE", r"FRANCE"],
    "DEU": [r"BUNDESREPUBLIK\s+DEUTSCHLAND", r"GERMANY", r"DEUTSCHLAND"],
}

# Passport MRZ patterns (TD3 format - 2 lines of 44 chars)
# Note: OCR may separate lines with space, newline, or nothing - use \s* to match any whitespace
MRZ_PATTERN = r"P<[A-Z]{3}[A-Z<]+<<[A-Z<]+<*\s*[A-Z0-9<]{44}"


def normalize_cedula_number(raw: str) -> str:
    """Normalize cedula to XXX-XXXXXXX-X format using python-stdnum."""
    try:
        # Use stdnum for proper formatting
        return do_cedula.format(do_cedula.compact(raw))
    except (ValidationError, Exception):
        # Fallback to manual formatting if stdnum fails
        digits = re.sub(r"[^\d]", "", raw)
        if len(digits) == 11:
            return f"{digits[:3]}-{digits[3:10]}-{digits[10]}"
        return raw


def get_country_name(code: str) -> str | None:
    """
    Get country name from ISO 3166-1 alpha-3 code.

    Uses iso3166 as primary (lightweight), mrz library as fallback.
    """
    if not code:
        return None

    # Try iso3166 first (lightweight, comprehensive)
    try:
        country = iso3166.countries.get(code)
        if country:
            return country.name
    except (KeyError, AttributeError):
        pass

    # Fallback to mrz library (already in use for MRZ parsing)
    try:
        name = mrz_get_country(code)
        if name:
            return name
    except (KeyError, ValueError, AttributeError):
        # mrz library doesn't recognize this code
        pass

    return None


def parse_date_to_iso(date_str: str) -> str | None:
    """Convert date string to YYYY-MM-DD format."""
    if not date_str:
        return None

    # Try DD/MM/YYYY or DD-MM-YYYY
    match = re.match(r"(\d{2})[/-](\d{2})[/-](\d{4})", date_str)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"

    # Try YYMMDD (MRZ format)
    match = re.match(r"(\d{2})(\d{2})(\d{2})", date_str)
    if match:
        yy, mm, dd = match.groups()
        # Assume 20xx for years < 50, 19xx for >= 50
        century = "20" if int(yy) < 50 else "19"
        return f"{century}{yy}-{mm}-{dd}"

    return None


def detect_country_from_text(text: str) -> str | None:
    """
    Detect country code from document text.

    Searches for country-specific markers (text patterns) in the OCR output.
    Detection priority follows COUNTRY_MARKERS dict iteration order.
    Earlier entries take precedence when multiple patterns match.

    Args:
        text: Raw OCR text from document

    Returns:
        ISO 3166-1 alpha-3 country code (e.g., "DOM", "ESP") or None
    """
    text_upper = text.upper()
    for country_code, patterns in COUNTRY_MARKERS.items():
        for pattern in patterns:
            if re.search(pattern, text_upper, re.IGNORECASE):
                return country_code
    return None


def extract_national_id_fields(text: str) -> ExtractedData:
    """Extract fields from national ID card OCR text (supports multiple countries)."""
    data = ExtractedData()
    text_upper = text.upper()

    # Detect country from document text
    detected_country = detect_country_from_text(text)
    if detected_country:
        data.nationality_code = detected_country
        data.nationality = get_country_name(detected_country) or detected_country

    # Document number - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["document_number"]:
        match = re.search(pattern, text_upper)
        if match:
            doc_num = match.group(1)
            # Normalize Dominican cedula format if applicable
            if detected_country == "DOM" and len(re.sub(r"[^\d]", "", doc_num)) == 11:
                data.document_number = normalize_cedula_number(doc_num)
            else:
                data.document_number = doc_num
            break

    # Extract first name - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["first_name"]:
        first_match = re.search(pattern, text_upper)
        if first_match:
            first_raw = first_match.group(1).strip()
            first_clean = re.split(FIRST_NAME_STOP_WORDS, first_raw)[0].strip()
            data.first_name = first_clean.title()
            break

    # Extract last name - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["last_name"]:
        last_match = re.search(pattern, text_upper)
        if last_match:
            last_raw = last_match.group(1).strip()
            last_clean = re.split(LAST_NAME_STOP_WORDS, last_raw)[0].strip()
            data.last_name = last_clean.title()
            break

    # Combine for full_name
    if data.first_name and data.last_name:
        data.full_name = f"{data.first_name} {data.last_name}"
    elif data.first_name:
        data.full_name = data.first_name
    elif data.last_name:
        data.full_name = data.last_name

    # Fallback: try to find name without labels
    if not data.full_name:
        name_pattern = (
            r"\b([A-ZÁÉÍÓÚÑÀÂÇÈÊËÎÏÔÛÙÜŸ]{3,}"
            r"(?:\s+[A-ZÁÉÍÓÚÑÀÂÇÈÊËÎÏÔÛÙÜŸ]{2,}){1,5})\b"
        )
        name_match = re.search(name_pattern, text_upper)
        if name_match:
            potential_name = name_match.group(1)
            # Exclude common non-name phrases
            exclude = [
                "REPUBLICA",
                "REPUBLIC",
                "JUNTA",
                "CENTRAL",
                "ELECTORAL",
                "CEDULA",
                "IDENTITY",
                "NATIONAL",
                "CARD",
                "DOCUMENTO",
                "ESPAÑA",
                "FRANCE",
            ]
            if not any(ex in potential_name for ex in exclude):
                data.full_name = potential_name.title()

    # Date of birth - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["date_of_birth"]:
        dob_match = re.search(pattern, text_upper)
        if dob_match:
            data.date_of_birth = parse_date_to_iso(dob_match.group(1))
            break

    # Fallback: try generic date pattern
    if not data.date_of_birth:
        date_matches = re.findall(r"\b(\d{2}[/-]\d{2}[/-]\d{4})\b", text_upper)
        if date_matches:
            data.date_of_birth = parse_date_to_iso(date_matches[0])

    # Expiration date - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["expiration_date"]:
        exp_match = re.search(pattern, text_upper)
        if exp_match:
            data.expiration_date = parse_date_to_iso(exp_match.group(1))
            break

    # Gender - try each pattern
    for pattern in NATIONAL_ID_PATTERNS["gender"]:
        gender_match = re.search(pattern, text_upper)
        if gender_match:
            data.gender = gender_match.group(1)
            break

    return data


def _mrz_date_to_iso(date_str: str) -> str | None:
    """Convert MRZ date (YYMMDD) to ISO format (YYYY-MM-DD)."""
    if not date_str or len(date_str) != 6:
        return None
    try:
        yy, mm, dd = date_str[:2], date_str[2:4], date_str[4:6]
        century = "20" if int(yy) < 50 else "19"
        return f"{century}{yy}-{mm}-{dd}"
    except ValueError:
        return None


def parse_mrz(mrz_text: str) -> tuple[ExtractedData, bool]:
    """
    Parse passport MRZ using ICAO 9303 standard library.

    Returns:
        tuple: (ExtractedData, is_valid) where is_valid indicates checksum passed
    """
    data = ExtractedData()
    is_valid = False

    # Clean and normalize MRZ text
    lines = mrz_text.strip().replace(" ", "").split("\n")
    if len(lines) < 2:
        mrz_clean = mrz_text.replace(" ", "").replace("\n", "")
        if len(mrz_clean) >= 88:
            lines = [mrz_clean[:44], mrz_clean[44:88]]
        else:
            return data, False

    try:
        # Use standard library for parsing
        mrz_string = "\n".join(lines[:2])
        checker = TD3CodeChecker(mrz_string)
        fields = checker.fields()
        is_valid = bool(checker)  # Checksums valid

        # Map to ExtractedData
        data.last_name = fields.surname.title() if fields.surname else None
        data.first_name = fields.name.title() if fields.name else None
        data.document_number = fields.document_number
        data.date_of_birth = _mrz_date_to_iso(fields.birth_date)
        data.expiration_date = _mrz_date_to_iso(fields.expiry_date)
        data.gender = fields.sex if fields.sex in ("M", "F") else None

        # Handle nationality with OCR error correction
        nationality_code = fields.nationality
        corrected_code, _ = correct_country_code(nationality_code)
        data.nationality_code = corrected_code

        # Use library's country name lookup (iso3166 + mrz fallback)
        country_name = get_country_name(corrected_code)
        data.nationality = country_name or corrected_code

        # Extract issuing country (separate from nationality)
        # The issuing country is in the "country" field of the MRZ library
        issuing_code = fields.country
        if issuing_code:
            corrected_issuing, _ = correct_country_code(issuing_code)
            data.issuing_country_code = corrected_issuing
            issuing_name = get_country_name(corrected_issuing)
            data.issuing_country = issuing_name or corrected_issuing

        # Build full name (Given Names + Surname)
        if data.first_name and data.last_name:
            data.full_name = f"{data.first_name} {data.last_name}"
        elif data.first_name:
            data.full_name = data.first_name
        elif data.last_name:
            data.full_name = data.last_name

    except (ValueError, AttributeError, IndexError, TypeError):
        # MRZ library failed to parse - expected when OCR doesn't detect valid MRZ.
        # Common causes: corrupted MRZ text, partial detection, wrong document type.
        pass

    return data, is_valid


def extract_passport_fields(text: str) -> tuple[ExtractedData, bool]:
    """
    Extract fields from passport OCR text.

    Returns:
        tuple: (ExtractedData, is_valid) where is_valid indicates MRZ checksum passed
    """
    # First try to find and parse MRZ
    mrz_match = re.search(MRZ_PATTERN, text, re.MULTILINE)
    if mrz_match:
        return parse_mrz(mrz_match.group(0))

    # Fallback to text-based extraction (no validation possible)
    data = ExtractedData()
    text_upper = text.upper()

    # Look for passport number pattern
    pass_match = re.search(r"\b([A-Z]{2}\d{7})\b", text_upper)
    if pass_match:
        data.document_number = pass_match.group(1)

    # Look for name after common labels
    name_match = re.search(
        r"(?:NOMBRE|NAME|TITULAR)\s*[:.]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)", text_upper
    )
    if name_match:
        data.full_name = name_match.group(1).strip()

    return data, False  # No MRZ validation possible in fallback


def extract_drivers_license_fields(text: str) -> ExtractedData:
    """Extract fields from driver's license OCR text."""
    data = ExtractedData()
    text_upper = text.upper()

    # Detect country from document text
    detected_country = detect_country_from_text(text)
    if detected_country:
        data.nationality_code = detected_country
        data.nationality = get_country_name(detected_country) or detected_country

    # License number patterns (multilingual)
    license_patterns = [
        r"(?:LICENCIA|LIC\.?\s*(?:NO|NUM)?\.?\s*[:.]?\s*)([A-Z0-9-]+)",  # Spanish
        r"(?:LICENSE\s*(?:NO|NUM|NUMBER)?\.?\s*[:.]?\s*)([A-Z0-9-]+)",  # English
        r"(?:PERMIS\s*(?:NO|NUM)?\.?\s*[:.]?\s*)([A-Z0-9-]+)",  # French
    ]

    for pattern in license_patterns:
        lic_match = re.search(pattern, text_upper)
        if lic_match:
            data.document_number = lic_match.group(1)
            break

    # Try national ID number as document number (common in some countries)
    if not data.document_number:
        for pattern in NATIONAL_ID_PATTERNS["document_number"]:
            match = re.search(pattern, text_upper)
            if match:
                doc_num = match.group(1)
                if detected_country == "DOM" and len(re.sub(r"[^\d]", "", doc_num)) == 11:
                    data.document_number = normalize_cedula_number(doc_num)
                else:
                    data.document_number = doc_num
                break

    # Name - try multiple patterns
    name_patterns = [
        r"(?:NOMBRE|NAME)\s*[:.]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)",
        r"(?:FULL\s*NAME|TITULAR)\s*[:.]?\s*([A-Z][A-Z\s]+)",
    ]
    for pattern in name_patterns:
        name_match = re.search(pattern, text_upper)
        if name_match:
            data.full_name = name_match.group(1).strip().title()
            break

    # Date of birth - reuse national ID patterns
    for pattern in NATIONAL_ID_PATTERNS["date_of_birth"]:
        dob_match = re.search(pattern, text_upper)
        if dob_match:
            data.date_of_birth = parse_date_to_iso(dob_match.group(1))
            break

    # Expiration date - reuse national ID patterns
    for pattern in NATIONAL_ID_PATTERNS["expiration_date"]:
        exp_match = re.search(pattern, text_upper)
        if exp_match:
            data.expiration_date = parse_date_to_iso(exp_match.group(1))
            break

    return data

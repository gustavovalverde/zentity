"""
Document field extraction using regex patterns.

Supports:
- Dominican Republic Cedula (XXX-XXXXXXX-X)
- Passport with MRZ parsing
- Driver's License
"""

import re
from typing import Optional, Tuple
from dataclasses import dataclass

from mrz.checker.td3 import TD3CodeChecker
from mrz.base.countries_ops import is_code, get_country


@dataclass
class ExtractedData:
    full_name: Optional[str] = None
    first_name: Optional[str] = None  # Nombres
    last_name: Optional[str] = None   # Apellidos
    document_number: Optional[str] = None
    date_of_birth: Optional[str] = None  # YYYY-MM-DD
    expiration_date: Optional[str] = None  # YYYY-MM-DD
    nationality: Optional[str] = None       # Full country name
    nationality_code: Optional[str] = None  # ISO 3166-1 alpha-3 code
    gender: Optional[str] = None


# Common OCR character confusions in MRZ
OCR_SUBSTITUTIONS = [
    ('0', 'O'),  # Zero ↔ Letter O (most common)
    ('1', 'I'),  # One ↔ Letter I
    ('5', 'S'),  # Five ↔ Letter S
    ('8', 'B'),  # Eight ↔ Letter B
    ('2', 'Z'),  # Two ↔ Letter Z
]


def correct_country_code(code: str) -> Tuple[str, bool]:
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


# Dominican Republic Cedula patterns
CEDULA_PATTERNS = {
    # Format: XXX-XXXXXXX-X (11 digits with dashes or spaces)
    "document_number": r"\b(\d{3}[-\s]?\d{7}[-\s]?\d{1})\b",
    # Name patterns (NOMBRE: or NOMBRES:)
    "first_name": r"(?:NOMBRE[S]?\s*[:.]?\s*)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)",
    "last_name": r"(?:APELLIDO[S]?\s*[:.]?\s*)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)",
    # Date patterns (DD/MM/YYYY or DD-MM-YYYY)
    "date_of_birth": r"(?:FECHA\s*(?:DE\s*)?NAC(?:IMIENTO)?\s*[:.]?\s*)(\d{2}[/-]\d{2}[/-]\d{4})",
    "expiration_date": r"(?:VENCE|EXPIRA(?:CION)?|VALIDO?\s*HASTA)\s*[:.]?\s*(\d{2}[/-]\d{2}[/-]\d{4})",
    # Gender
    "gender": r"(?:SEXO\s*[:.]?\s*)([MF])",
}

# Passport MRZ patterns (TD3 format - 2 lines of 44 chars)
# Note: OCR may separate lines with space, newline, or nothing - use \s* to match any whitespace
MRZ_PATTERN = r"P<[A-Z]{3}[A-Z<]+<<[A-Z<]+<*\s*[A-Z0-9<]{44}"


def normalize_cedula_number(raw: str) -> str:
    """Normalize cedula to XXX-XXXXXXX-X format."""
    digits = re.sub(r"[^\d]", "", raw)
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:10]}-{digits[10]}"
    return raw


def parse_date_to_iso(date_str: str) -> Optional[str]:
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


def extract_cedula_fields(text: str) -> ExtractedData:
    """Extract fields from Dominican cedula OCR text."""
    data = ExtractedData()
    text_upper = text.upper()

    # Document number
    match = re.search(CEDULA_PATTERNS["document_number"], text_upper)
    if match:
        data.document_number = normalize_cedula_number(match.group(1))

    # Extract first and last names separately
    first_match = re.search(CEDULA_PATTERNS["first_name"], text_upper)
    last_match = re.search(CEDULA_PATTERNS["last_name"], text_upper)

    if first_match:
        # Clean up: stop at next label or date pattern
        first_raw = first_match.group(1).strip()
        first_clean = re.split(r'\s+(?:APELLIDO|FECHA|SEXO|NACIMIENTO|VENCE)', first_raw)[0].strip()
        data.first_name = first_clean.title()

    if last_match:
        # Clean up: stop at next label or date pattern
        last_raw = last_match.group(1).strip()
        last_clean = re.split(r'\s+(?:NOMBRE|FECHA|SEXO|NACIMIENTO|VENCE)', last_raw)[0].strip()
        data.last_name = last_clean.title()

    # Combine for full_name
    if data.first_name and data.last_name:
        data.full_name = f"{data.first_name} {data.last_name}"
    elif data.first_name:
        data.full_name = data.first_name
    elif data.last_name:
        data.full_name = data.last_name

    # Fallback: try to find name without labels
    if not data.full_name:
        # Look for uppercase names (at least 2 words of 3+ chars)
        name_match = re.search(
            r"\b([A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){1,5})\b", text_upper
        )
        if name_match:
            potential_name = name_match.group(1)
            # Exclude common non-name phrases
            exclude = ["REPUBLICA DOMINICANA", "JUNTA CENTRAL", "ELECTORAL", "CEDULA"]
            if not any(ex in potential_name for ex in exclude):
                data.full_name = potential_name.title()

    # Date of birth
    dob_match = re.search(CEDULA_PATTERNS["date_of_birth"], text_upper)
    if dob_match:
        data.date_of_birth = parse_date_to_iso(dob_match.group(1))

    # Try generic date pattern if specific one fails
    if not data.date_of_birth:
        date_matches = re.findall(r"\b(\d{2}[/-]\d{2}[/-]\d{4})\b", text_upper)
        if date_matches:
            data.date_of_birth = parse_date_to_iso(date_matches[0])

    # Expiration date
    exp_match = re.search(CEDULA_PATTERNS["expiration_date"], text_upper)
    if exp_match:
        data.expiration_date = parse_date_to_iso(exp_match.group(1))

    # Gender
    gender_match = re.search(CEDULA_PATTERNS["gender"], text_upper)
    if gender_match:
        data.gender = gender_match.group(1)

    # Nationality is always Dominican for cedula
    data.nationality_code = "DOM"
    data.nationality = get_country("DOM") or "Dominican Republic"

    return data


def _mrz_date_to_iso(date_str: str) -> Optional[str]:
    """Convert MRZ date (YYMMDD) to ISO format (YYYY-MM-DD)."""
    if not date_str or len(date_str) != 6:
        return None
    try:
        yy, mm, dd = date_str[:2], date_str[2:4], date_str[4:6]
        century = "20" if int(yy) < 50 else "19"
        return f"{century}{yy}-{mm}-{dd}"
    except ValueError:
        return None


def parse_mrz(mrz_text: str) -> Tuple[ExtractedData, bool]:
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

        # Use library's country name lookup (no hardcoding)
        country_name = get_country(corrected_code)
        data.nationality = country_name or corrected_code

        # Build full name (Given Names + Surname)
        if data.first_name and data.last_name:
            data.full_name = f"{data.first_name} {data.last_name}"
        elif data.first_name:
            data.full_name = data.first_name
        elif data.last_name:
            data.full_name = data.last_name

    except Exception:
        # Library failed - return empty data
        pass

    return data, is_valid


def extract_passport_fields(text: str) -> Tuple[ExtractedData, bool]:
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

    # License number pattern
    lic_match = re.search(
        r"(?:LICENCIA|LIC\.?\s*(?:NO|NUM)?\.?\s*[:.]?\s*)([A-Z0-9-]+)", text_upper
    )
    if lic_match:
        data.document_number = lic_match.group(1)

    # Try cedula number as document number (common in DR licenses)
    if not data.document_number:
        ced_match = re.search(CEDULA_PATTERNS["document_number"], text_upper)
        if ced_match:
            data.document_number = normalize_cedula_number(ced_match.group(1))

    # Name
    name_match = re.search(
        r"(?:NOMBRE|NAME)\s*[:.]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+)", text_upper
    )
    if name_match:
        data.full_name = name_match.group(1).strip()

    # Reuse cedula patterns for dates
    dob_match = re.search(CEDULA_PATTERNS["date_of_birth"], text_upper)
    if dob_match:
        data.date_of_birth = parse_date_to_iso(dob_match.group(1))

    exp_match = re.search(CEDULA_PATTERNS["expiration_date"], text_upper)
    if exp_match:
        data.expiration_date = parse_date_to_iso(exp_match.group(1))

    # Try to detect nationality from document text
    # Driver's licenses don't have MRZ, so we check for country markers
    if re.search(r"REPUBLICA\s+DOMINICANA|REP\.?\s*DOM|DOMINICAN", text_upper):
        data.nationality_code = "DOM"
        data.nationality = get_country("DOM")
    # Add other countries as needed

    return data

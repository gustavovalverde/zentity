"""
Dynamic document validation using python-stdnum.

Uses established libraries for document number validation:
- python-stdnum: 200+ ID formats with proper checksums (dynamic discovery)
- iso3166: Country code conversion
- mrz: Passport MRZ validation (ICAO 9303)

Key features:
- Dynamic validator discovery via stdnum.get_cc_module()
- Supports 30+ countries automatically
- Rich, user-friendly error messages
"""

import re
from dataclasses import dataclass
from datetime import date, datetime

import iso3166
from stdnum import get_cc_module
from stdnum.exceptions import (
    InvalidChecksum,
    InvalidComponent,
    InvalidFormat,
    InvalidLength,
    ValidationError,
)

# =============================================================================
# Validator Module Discovery Priority
# =============================================================================

# Priority order for stdnum validator discovery.
# Personal ID modules are tried first (most specific), then tax IDs (fallback).
# Order matters: first match wins when multiple validators exist for a country.
_VALIDATOR_MODULE_PRIORITY = [
    # --- Primary personal identification documents ---
    "personalid",  # Generic (few countries use this exact name)
    "cedula",  # Dominican Republic, Ecuador
    "dni",  # Spain, Argentina
    "cpf",  # Brazil
    "curp",  # Mexico
    "rut",  # Chile
    "nie",  # Spain (foreign residents)
    "nif",  # Spain, Portugal (tax ID often used as personal)
    "pesel",  # Poland
    "bsn",  # Netherlands
    "personnummer",  # Sweden, Norway
    "fodselsnummer",  # Norway (alternative)
    "hetu",  # Finland
    "kennitala",  # Iceland
    "cpr",  # Denmark
    "nino",  # UK (National Insurance Number)
    "ssn",  # USA (Social Security Number)
    "sin",  # Canada (Social Insurance Number)
    "tfn",  # Australia (Tax File Number)
    "aadhaar",  # India
    "idnr",  # Germany
    "cnp",  # Romania
    "egn",  # Bulgaria
    "amka",  # Greece
    "isikukood",  # Estonia
    "asmens_kodas",  # Lithuania
    "oib",  # Croatia
    "emso",  # Slovenia
    "rodne_cislo",  # Czech Republic, Slovakia
    "rc",  # Czech Republic (alternative)
    "cui",  # Peru
    "ci",  # Ecuador (alternative)
    "cc",  # Portugal (Cartao de Cidadao)
    "ric",  # Costa Rica
    "identity_number",  # Israel
    # --- Fallback: tax/business IDs (sometimes used for identification) ---
    "nit",  # Colombia
    "rfc",  # Mexico (tax ID)
    "cuit",  # Argentina (tax ID)
    "vat",  # Generic VAT (last resort)
]


# =============================================================================
# Data Classes
# =============================================================================


@dataclass
class ValidatorInfo:
    """Information about a discovered validator."""

    module: object  # The stdnum module (has validate(), is_valid(), etc.)
    country_code: str  # Alpha-2 code (e.g., "do")
    module_name: str  # Module name (e.g., "cedula")
    full_path: str  # Full path (e.g., "stdnum.do.cedula")
    display_name: str  # Human-readable name (from module docstring)


@dataclass
class ValidationResult:
    """Result of document number validation with rich error info."""

    is_valid: bool
    error_code: str | None = None  # Machine-readable code
    error_message: str | None = None  # Human-readable message
    validator_used: str | None = None  # e.g., "stdnum.do.cedula"
    format_name: str | None = None  # e.g., "cedula (Dominican Republic national ID)"


# =============================================================================
# Country Code Conversion
# =============================================================================


def alpha3_to_alpha2(alpha3_code: str) -> str | None:
    """
    Convert ISO 3166-1 alpha-3 code to alpha-2 code (lowercase).

    Uses iso3166 library (already a dependency).

    Args:
        alpha3_code: 3-letter country code (e.g., "DOM", "ESP")

    Returns:
        2-letter country code (e.g., "do", "es") or None if not found
    """
    if not alpha3_code:
        return None

    try:
        country = iso3166.countries.get(alpha3_code)
        if country:
            return country.alpha2.lower()
    except (KeyError, AttributeError):
        pass
    return None


def get_country_display_name(alpha3_code: str) -> str:
    """Get human-readable country name from alpha-3 code."""
    if not alpha3_code:
        return "Unknown"

    try:
        country = iso3166.countries.get(alpha3_code)
        if country:
            return country.name
    except (KeyError, AttributeError):
        pass

    return alpha3_code  # Fallback to code itself


# =============================================================================
# Dynamic Validator Discovery
# =============================================================================


def _extract_display_name(module: object, module_name: str) -> str:
    """Extract human-readable name from module docstring."""
    doc = getattr(module, "__doc__", "")
    if doc:
        # First line of docstring usually contains the format name
        first_line = doc.strip().split("\n")[0]
        # Remove trailing period and clean up
        name = first_line.rstrip(".").strip()
        if name:
            return name
    return module_name.upper()


def discover_validator(alpha3_code: str) -> ValidatorInfo | None:
    """
    Dynamically discover the appropriate validator for a country.

    Uses stdnum.get_cc_module() to find country-specific validators
    without needing hardcoded imports.

    Args:
        alpha3_code: ISO 3166-1 alpha-3 country code (e.g., "DOM", "ESP")

    Returns:
        ValidatorInfo if a validator was found, None otherwise
    """
    # Step 1: Convert alpha-3 to alpha-2
    alpha2_code = alpha3_to_alpha2(alpha3_code)
    if not alpha2_code:
        return None

    # Step 2: Try each module name in priority order
    for module_name in _VALIDATOR_MODULE_PRIORITY:
        try:
            module = get_cc_module(alpha2_code, module_name)
            if module is not None and hasattr(module, "validate"):
                # Extract display name from module docstring
                display_name = _extract_display_name(module, module_name)

                return ValidatorInfo(
                    module=module,
                    country_code=alpha2_code,
                    module_name=module_name,
                    full_path=f"stdnum.{alpha2_code}.{module_name}",
                    display_name=display_name,
                )
        except (ImportError, AttributeError):
            # Module doesn't exist for this country, try next
            continue

    return None


# =============================================================================
# Rich Validation with User-Friendly Errors
# =============================================================================


# Error mapping for validation exceptions - reduces repetitive exception handlers
_VALIDATION_ERROR_MAP: dict[type, tuple[str, str]] = {
    InvalidLength: (
        "invalid_document_length",
        "The document number has an incorrect length for {country}. "
        "A valid {format} should have the correct number of digits.",
    ),
    InvalidChecksum: (
        "invalid_document_checksum",
        "The document number appears to be invalid for {country}. "
        "The check digit doesn't match what's expected for a {format}. "
        "Please verify it's correct.",
    ),
    InvalidFormat: (
        "invalid_document_format",
        "The document number format is incorrect for {country}. "
        "A {format} should contain only valid characters in the expected format.",
    ),
    InvalidComponent: (
        "invalid_document_component",
        "Part of the document number is invalid for {country}. "
        "This could indicate an invalid date, region code, or other embedded value.",
    ),
}


def validate_document_number(number: str, country_code: str | None) -> ValidationResult:
    """
    Validate a national ID/document number with rich error reporting.

    Returns ValidationResult with:
    - Clear, actionable error messages for users
    - Which validator was used (for debugging)
    - Specific error codes for programmatic handling

    Args:
        number: The document number to validate
        country_code: ISO 3166-1 alpha-3 code (e.g., "DOM", "ESP")

    Returns:
        ValidationResult with validation status and details
    """
    if not number:
        return ValidationResult(
            is_valid=False,
            error_code="missing_document_number",
            error_message="Document number is required.",
        )

    if not country_code:
        # Can't validate without knowing the country
        return ValidationResult(
            is_valid=True,
            error_code=None,
            error_message=None,
        )

    # Discover the appropriate validator
    validator_info = discover_validator(country_code)
    country_name = get_country_display_name(country_code)

    if not validator_info:
        # No validator available for this country - warn but don't fail
        return ValidationResult(
            is_valid=True,  # Don't block the user
            error_code="validation_unavailable_for_country",
            error_message=(
                f"Document validation is not available for {country_name}. "
                f"The document number format could not be verified."
            ),
        )

    # Attempt validation with error mapping
    try:
        validator_info.module.validate(number)
        return ValidationResult(
            is_valid=True,
            validator_used=validator_info.full_path,
            format_name=validator_info.display_name,
        )

    except (InvalidLength, InvalidChecksum, InvalidFormat, InvalidComponent) as e:
        # Use error mapping for specific exception types
        error_code, message_template = _VALIDATION_ERROR_MAP[type(e)]
        return ValidationResult(
            is_valid=False,
            error_code=error_code,
            error_message=message_template.format(
                country=country_name,
                format=validator_info.display_name,
            ),
            validator_used=validator_info.full_path,
            format_name=validator_info.display_name,
        )

    except ValidationError:
        # Catch-all for any other validation error
        return ValidationResult(
            is_valid=False,
            error_code="invalid_document_number",
            error_message=(
                f"The document number doesn't appear to be valid for {country_name}. "
                f"Please check that you've entered a correct {validator_info.display_name}."
            ),
            validator_used=validator_info.full_path,
            format_name=validator_info.display_name,
        )


def validate_national_id_detailed(number: str, country_code: str | None) -> ValidationResult:
    """
    Validate national ID with full error details.

    Use this when you need:
    - Human-readable error messages for UI display
    - Which validator was used (for logging/debugging)
    - Detailed error context

    Args:
        number: The document number to validate
        country_code: ISO 3166-1 alpha-3 country code

    Returns:
        ValidationResult with full details
    """
    return validate_document_number(number, country_code)


# =============================================================================
# Other Validators
# =============================================================================


def validate_passport_number(number: str) -> list[str]:
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


def validate_expiration_date(exp_date: str) -> list[str]:
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


def validate_dob(dob: str) -> list[str]:
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


# =============================================================================
# Confidence Scoring Configuration
# =============================================================================

# Text length thresholds for quality scoring (empirically tuned for ID documents).
# Higher text extraction typically indicates better OCR quality and more complete scans.
TEXT_LENGTH_HIGH = 200  # Full page documents (passports, detailed IDs)
TEXT_LENGTH_MEDIUM = 100  # Partial page or cropped documents
TEXT_LENGTH_LOW = 50  # Minimal text (may indicate poor scan quality)

# Confidence score weights - must sum to 1.0 for normalized output.
# Weights reflect relative importance of each factor for identity documents.
TEXT_QUALITY_MAX_SCORE = 0.3  # 30% - text extraction quality
FIELD_EXTRACTION_MAX_SCORE = 0.4  # 40% - structured fields extracted (most important)
OCR_CONFIDENCE_MAX_SCORE = 0.3  # 30% - raw OCR engine confidence

# Points per extracted field (document_number, full_name, dob, expiry)
POINTS_PER_FIELD = 0.1  # 10% per field, max 4 fields = 40%


def calculate_confidence(
    text_length: int,
    fields_extracted: int,
    ocr_avg_confidence: float,
) -> float:
    """
    Calculate overall document confidence score.

    The score combines three factors:
    - Text extraction quality (30%): Based on total characters extracted
    - Field extraction (40%): Based on number of identity fields parsed
    - OCR confidence (30%): Average confidence from OCR engine

    Args:
        text_length: Total characters extracted from document
        fields_extracted: Number of identity fields successfully parsed (max 4)
        ocr_avg_confidence: Average OCR confidence score (0.0-1.0)

    Returns:
        Confidence score between 0.0 and 1.0
    """
    score = 0.0

    # Text extraction quality (0-0.3)
    if text_length > TEXT_LENGTH_HIGH:
        score += TEXT_QUALITY_MAX_SCORE
    elif text_length > TEXT_LENGTH_MEDIUM:
        score += TEXT_QUALITY_MAX_SCORE * 0.67  # ~0.2
    elif text_length > TEXT_LENGTH_LOW:
        score += TEXT_QUALITY_MAX_SCORE * 0.33  # ~0.1

    # Fields extracted (0-0.4)
    field_score = min(FIELD_EXTRACTION_MAX_SCORE, fields_extracted * POINTS_PER_FIELD)
    score += field_score

    # OCR confidence (0-0.3)
    score += ocr_avg_confidence * OCR_CONFIDENCE_MAX_SCORE

    return min(1.0, score)

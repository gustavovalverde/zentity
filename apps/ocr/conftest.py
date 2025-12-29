"""
Pytest configuration for OCR service tests.

Provides fixtures for:
- Sample document data (cedula, passport numbers, names)
- Test images organized by document type (passports, ID cards, resident cards, visas)
- Sample OCR text for parser testing
- Edge case fixtures (blank images, corrupted files, etc.)

Test images from: https://github.com/Arg0s1080/mrz/tree/master/docs/images
"""

import base64
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).parent
SRC_DIR = ROOT_DIR / "src"
if SRC_DIR.exists():
    sys.path.insert(0, str(SRC_DIR))

# Test fixtures directories
FIXTURES_DIR = Path(__file__).parent / "tests" / "fixtures"
IMAGES_DIR = FIXTURES_DIR / "images"
PASSPORTS_DIR = IMAGES_DIR / "passports"
ID_CARDS_DIR = IMAGES_DIR / "id_cards"
RESIDENT_CARDS_DIR = IMAGES_DIR / "resident_cards"
VISAS_DIR = IMAGES_DIR / "visas"


def _load_image_base64(path: Path) -> str:
    """Load an image file and return base64 encoded string."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


# =============================================================================
# Sample Document Data Fixtures
# =============================================================================


@pytest.fixture
def sample_document_number():
    """Sample DR cedula number for testing."""
    return "001-1234567-8"


@pytest.fixture
def sample_name():
    """Sample name for testing."""
    return "Juan Carlos Pérez González"


@pytest.fixture
def sample_salt():
    """Fixed salt for deterministic testing."""
    return "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"


# =============================================================================
# Passport Image Fixtures (TD3 format - 2-line MRZ)
# =============================================================================


@pytest.fixture
def passport_icao_image_path():
    """Path to ICAO standard test passport image with MRZ."""
    return PASSPORTS_DIR / "ICAO_Example.png"


@pytest.fixture
def passport_icao_base64(passport_icao_image_path):
    """Base64 encoded ICAO passport image."""
    return _load_image_base64(passport_icao_image_path)


@pytest.fixture
def passport_icao2_base64():
    """Base64 encoded second ICAO passport example."""
    return _load_image_base64(PASSPORTS_DIR / "ICAO_Example2.png")


@pytest.fixture
def passport_ukraine_image_path():
    """Path to Ukraine passport image with MRZ."""
    return PASSPORTS_DIR / "Ukraine.png"


@pytest.fixture
def passport_ukraine_base64(passport_ukraine_image_path):
    """Base64 encoded Ukraine passport image."""
    return _load_image_base64(passport_ukraine_image_path)


@pytest.fixture
def passport_canada_base64():
    """Base64 encoded Canada passport image."""
    return _load_image_base64(PASSPORTS_DIR / "Canada.png")


@pytest.fixture
def passport_china_base64():
    """Base64 encoded China passport image."""
    return _load_image_base64(PASSPORTS_DIR / "China.png")


@pytest.fixture
def passport_czech_base64():
    """Base64 encoded Czech Republic passport image."""
    return _load_image_base64(PASSPORTS_DIR / "Czech_Republic.png")


@pytest.fixture
def passport_iceland_base64():
    """Base64 encoded Iceland passport image."""
    return _load_image_base64(PASSPORTS_DIR / "Iceland.png")


@pytest.fixture
def passport_interpol_base64():
    """Base64 encoded Interpol travel document image."""
    return _load_image_base64(PASSPORTS_DIR / "Interpol.png")


@pytest.fixture
def passport_japan_base64():
    """Base64 encoded Japan passport image."""
    return _load_image_base64(PASSPORTS_DIR / "Japan.png")


@pytest.fixture
def passport_qatar_base64():
    """Base64 encoded Qatar passport image."""
    return _load_image_base64(PASSPORTS_DIR / "Qatar.png")


@pytest.fixture(
    params=[
        "ICAO_Example.png",
        "Canada.png",
        "China.png",
        "Czech_Republic.png",
        "Iceland.png",
        "Japan.png",
        "Qatar.png",
        "Ukraine.png",
    ]
)
def any_passport_base64(request):
    """Parameterized fixture for testing across all passport images."""
    return _load_image_base64(PASSPORTS_DIR / request.param)


# =============================================================================
# ID Card Image Fixtures (TD1 format - 3-line MRZ)
# =============================================================================


@pytest.fixture
def id_card_spain_image_path():
    """Path to Spanish national ID card image."""
    return ID_CARDS_DIR / "Spain.png"


@pytest.fixture
def id_card_spain_base64(id_card_spain_image_path):
    """Base64 encoded Spanish ID card image."""
    return _load_image_base64(id_card_spain_image_path)


@pytest.fixture
def id_card_peru_image_path():
    """Path to Peru national ID card image."""
    return ID_CARDS_DIR / "Peru.png"


@pytest.fixture
def id_card_peru_base64(id_card_peru_image_path):
    """Base64 encoded Peru ID card image."""
    return _load_image_base64(id_card_peru_image_path)


@pytest.fixture
def id_card_latvia_base64():
    """Base64 encoded Latvia ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Latvia.png")


@pytest.fixture
def id_card_liechtenstein_base64():
    """Base64 encoded Liechtenstein ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Liechtenstein.png")


@pytest.fixture
def id_card_lithuania_base64():
    """Base64 encoded Lithuania ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Lithuania.png")


@pytest.fixture
def id_card_malta_bad_base64():
    """Base64 encoded Malta ID card image (low quality for edge case testing)."""
    return _load_image_base64(ID_CARDS_DIR / "Malta_BAD.png")


@pytest.fixture
def id_card_monaco_base64():
    """Base64 encoded Monaco ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Monaco.png")


@pytest.fixture
def id_card_serbia_base64():
    """Base64 encoded Serbia ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Serbia.png")


@pytest.fixture
def id_card_sweden_base64():
    """Base64 encoded Sweden ID card image."""
    return _load_image_base64(ID_CARDS_DIR / "Sweden.png")


@pytest.fixture(
    params=[
        "Spain.png",
        "Peru.png",
        "Latvia.png",
        "Liechtenstein.png",
        "Lithuania.png",
        "Monaco.png",
        "Serbia.png",
        "Sweden.png",
    ]
)
def any_id_card_base64(request):
    """Parameterized fixture for testing across all ID card images."""
    return _load_image_base64(ID_CARDS_DIR / request.param)


# =============================================================================
# Resident Card Image Fixtures (TD1/TD2 format)
# =============================================================================


@pytest.fixture
def resident_card_france_base64():
    """Base64 encoded France resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "France.png")


@pytest.fixture
def resident_card_germany_base64():
    """Base64 encoded Germany resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "Germany.png")


@pytest.fixture
def resident_card_netherlands_base64():
    """Base64 encoded Netherlands resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "Netherland.png")


@pytest.fixture
def resident_card_portugal_base64():
    """Base64 encoded Portugal resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "Portugal.png")


@pytest.fixture
def resident_card_uk_base64():
    """Base64 encoded UK resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "UK.png")


@pytest.fixture
def resident_card_usa_base64():
    """Base64 encoded USA resident card (green card) image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "USA.png")


@pytest.fixture
def resident_card_usa_permanent_base64():
    """Base64 encoded USA permanent resident card image."""
    return _load_image_base64(RESIDENT_CARDS_DIR / "USA_Permanent.png")


@pytest.fixture(
    params=[
        "France.png",
        "Germany.png",
        "Netherland.png",
        "Portugal.png",
        "UK.png",
        "USA.png",
        "USA_Permanent.png",
    ]
)
def any_resident_card_base64(request):
    """Parameterized fixture for testing across all resident card images."""
    return _load_image_base64(RESIDENT_CARDS_DIR / request.param)


# =============================================================================
# Visa Image Fixtures (MRV-A and MRV-B formats)
# =============================================================================


@pytest.fixture
def visa_france_base64():
    """Base64 encoded France visa image."""
    return _load_image_base64(VISAS_DIR / "France.png")


@pytest.fixture
def visa_germany_base64():
    """Base64 encoded Germany visa image."""
    return _load_image_base64(VISAS_DIR / "Germany.png")


@pytest.fixture
def visa_mrva_icao_base64():
    """Base64 encoded ICAO MRV-A visa example (full page, 2-line MRZ)."""
    return _load_image_base64(VISAS_DIR / "MRVA_ICAO_Example.png")


@pytest.fixture
def visa_mrvb_icao_base64():
    """Base64 encoded ICAO MRV-B visa example (sticker, 2-line MRZ)."""
    return _load_image_base64(VISAS_DIR / "MRVB_ICAO_Example.png")


@pytest.fixture
def visa_usa_base64():
    """Base64 encoded USA visa image."""
    return _load_image_base64(VISAS_DIR / "USA.png")


@pytest.fixture
def visa_usa2_base64():
    """Base64 encoded USA visa image (variant 2)."""
    return _load_image_base64(VISAS_DIR / "USA2.png")


@pytest.fixture
def visa_uk_base64():
    """Base64 encoded UK visa image."""
    return _load_image_base64(VISAS_DIR / "United_Kingdom.png")


@pytest.fixture(
    params=[
        "France.png",
        "Germany.png",
        "MRVA_ICAO_Example.png",
        "MRVB_ICAO_Example.png",
        "USA.png",
        "United_Kingdom.png",
    ]
)
def any_visa_base64(request):
    """Parameterized fixture for testing across all visa images."""
    return _load_image_base64(VISAS_DIR / request.param)


# =============================================================================
# Edge Case Image Fixtures
# =============================================================================


@pytest.fixture
def blank_image_path():
    """Path to blank white image (for no-text testing)."""
    return IMAGES_DIR / "blank_white.png"


@pytest.fixture
def blank_image_base64(blank_image_path):
    """Base64 encoded blank white image."""
    return _load_image_base64(blank_image_path)


@pytest.fixture
def tiny_image_path():
    """Path to very small image (10x10) for edge case testing."""
    return IMAGES_DIR / "tiny_image.png"


@pytest.fixture
def tiny_image_base64(tiny_image_path):
    """Base64 encoded tiny image."""
    return _load_image_base64(tiny_image_path)


@pytest.fixture
def invalid_base64():
    """Invalid base64 string for error testing."""
    return "not-valid-base64-data!!@@##"


@pytest.fixture
def corrupted_file_base64():
    """Base64 encoded non-image file (for decode error testing)."""
    corrupted_path = IMAGES_DIR / "corrupted.bin"
    return _load_image_base64(corrupted_path)


@pytest.fixture
def base64_with_data_uri(passport_icao_base64):
    """Passport image with data URI prefix."""
    return f"data:image/png;base64,{passport_icao_base64}"


@pytest.fixture
def low_quality_id_base64():
    """Low quality ID card image for OCR edge case testing."""
    return _load_image_base64(ID_CARDS_DIR / "Malta_BAD.png")


# =============================================================================
# Sample OCR Text Fixtures (for parser tests without actual OCR)
# =============================================================================


@pytest.fixture
def passport_mrz_text_icao():
    """ICAO standard test MRZ text (from ICAO 9303 specification)."""
    return (
        "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10"
    )


@pytest.fixture
def passport_mrz_text_dominican():
    """Dominican Republic passport MRZ text."""
    return (
        "P<DOMVALVERDE<DE<SOTO<<GUSTAVO<ADOLFO<JR<<<<\nRD69703794DOM9205241M3006226<<<<<<<<<<<<<<02"
    )


@pytest.fixture
def national_id_text_dominican():
    """Sample Dominican cedula OCR text."""
    return """
    REPUBLICA DOMINICANA
    JUNTA CENTRAL ELECTORAL
    CEDULA DE IDENTIDAD Y ELECTORAL

    APELLIDOS: PEREZ GONZALEZ
    NOMBRES: JUAN CARLOS
    FECHA NAC: 15/05/1990
    SEXO: M
    001-1234567-8
    VENCE: 31/12/2028
    """


@pytest.fixture
def national_id_text_spanish():
    """Sample Spanish DNI OCR text."""
    return """
    ESPAÑA
    DOCUMENTO NACIONAL DE IDENTIDAD
    DNI

    APELLIDOS: GARCIA LOPEZ
    NOMBRE: MARIA
    FECHA NACIMIENTO: 20/03/1985
    SEXO: F
    12345678A
    VÁLIDO HASTA: 15/06/2030
    """


@pytest.fixture
def drivers_license_text():
    """Sample driver's license OCR text."""
    return """
    LICENCIA DE CONDUCIR
    REPUBLICA DOMINICANA

    NOMBRE: PEDRO MARTINEZ
    FECHA NAC: 10/08/1988
    LICENCIA NO: A123456789
    CATEGORÍA: B
    EXPIRA: 01/01/2026
    """


@pytest.fixture
def mixed_document_text():
    """Text with markers from multiple document types (edge case)."""
    return """
    PASAPORTE
    CEDULA DE IDENTIDAD
    P<DOM
    001-1234567-8
    """


@pytest.fixture
def empty_document_text():
    """Empty/minimal text (for no-extraction testing)."""
    return ""


@pytest.fixture
def gibberish_text():
    """Random text with no recognizable patterns."""
    return "XYZ123 QWERTY !@#$% Lorem ipsum dolor sit amet"


# =============================================================================
# Date Fixtures for Validation Testing
# =============================================================================


@pytest.fixture
def future_expiration_date():
    """Valid future expiration date."""
    return "2030-12-31"


@pytest.fixture
def past_expiration_date():
    """Expired document date."""
    return "2020-01-15"


@pytest.fixture
def adult_dob():
    """Date of birth for an adult (25 years old)."""
    return "2000-01-15"


@pytest.fixture
def minor_dob():
    """Date of birth for a minor (10 years old)."""
    return "2015-06-20"


@pytest.fixture
def impossible_dob():
    """Future date of birth (impossible)."""
    return "2030-01-01"


@pytest.fixture
def ancient_dob():
    """Date of birth > 150 years ago (invalid)."""
    return "1850-01-01"


# =============================================================================
# Document Number Fixtures for Validation Testing
# =============================================================================


@pytest.fixture
def valid_cedula_dominican():
    """Valid Dominican cedula with correct checksum."""
    return "001-1234567-8"


@pytest.fixture
def invalid_cedula_checksum():
    """Dominican cedula with invalid check digit."""
    return "001-1234567-0"


@pytest.fixture
def invalid_cedula_length():
    """Dominican cedula with wrong length."""
    return "001-123456-8"


@pytest.fixture
def valid_dni_spanish():
    """Valid Spanish DNI format."""
    return "12345678Z"


@pytest.fixture
def invalid_dni_format():
    """Invalid Spanish DNI format (missing letter)."""
    return "123456789"


@pytest.fixture
def valid_passport_number():
    """Valid passport number format."""
    return "AB1234567"


@pytest.fixture
def invalid_passport_short():
    """Too short passport number."""
    return "AB123"


@pytest.fixture
def invalid_passport_long():
    """Too long passport number."""
    return "AB12345678901234"


@pytest.fixture
def invalid_passport_special_chars():
    """Passport number with invalid special characters."""
    return "AB-123@567"

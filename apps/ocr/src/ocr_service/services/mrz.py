"""
ICAO Doc 9303 machine readable zone (MRZ) for TD3 travel documents (passports).

A TD3 MRZ is two lines of 44 characters from [A-Z0-9<]. This module splits the
lines into fields (Part 3, section 4.2.2) and validates the check digits
(Part 3, section 4.9). Field validity covers the document code, the issuing
State and nationality codes, the dates, the sex marker, and the name field.
"""

import calendar
import string
from dataclasses import dataclass

import iso3166

TD3_LINE_LENGTH = 44

_MRZ_CHARSET = frozenset(string.ascii_uppercase + string.digits + "<")
_CHECK_DIGIT_WEIGHTS = (7, 3, 1)

# Doc 9303 Part 3 allows M, F, and X (unspecified) in the sex field, with "<" as filler.
_SEX_MARKERS = frozenset("MFX<")

# Codes in Doc 9303 Part 3 that ISO 3166-1 alpha-3 does not define, plus the legacy and
# specimen codes the service has always accepted. Germany uses "D", not "DEU".
_ICAO_ONLY_CODES = {
    "ANT": "Netherlands Antilles",
    "D": "Germany",
    "EUE": "European Union",
    "GB": "United Kingdom",
    "GBD": "British Overseas Territories",
    "GBN": "British National Overseas",
    "GBO": "British Overseas Citizen",
    "GBP": "British Protected",
    "GBS": "British Subject",
    "INP": "Interpol",
    "NTZ": "Neutral Zone",
    "RKS": "Kosovo",
    "UNA": "United Nations Agency",
    "UNK": "Kosovo UN",
    "UNO": "United Nations Organization",
    "UTO": "Utopia",
    "XBA": "African Development Bank",
    "XCC": "Caricom",
    "XCO": "Comesa",
    "XEC": "Ecowas",
    "XIM": "Afrexim",
    "XOM": "Military Order Of Malta",
    "XXA": "Stateless",
    "XXB": "Refugee B",
    "XXX": "Unknown",
}

# ISO 3166-1 alpha-3 codes that Doc 9303 replaces: "D" for Germany, "RKS" for Kosovo.
_ISO_CODES_NOT_USED_IN_MRZ = frozenset({"DEU", "XKX"})

_ICAO_CODES = (
    frozenset(iso3166.countries_by_alpha3)
    .difference(_ISO_CODES_NOT_USED_IN_MRZ)
    .union(_ICAO_ONLY_CODES)
)


@dataclass(frozen=True)
class Td3Mrz:
    """Fields of a TD3 MRZ. Filler characters are stripped; dates stay as YYMMDD."""

    document_type: str
    issuing_state: str
    surname: str | None
    given_names: str | None
    document_number: str
    nationality: str
    birth_date: str
    sex: str
    expiry_date: str
    personal_number: str
    valid: bool


def is_icao_country_code(code: str) -> bool:
    """True when `code` is an issuing State or nationality code allowed in an MRZ."""
    return code.upper() in _ICAO_CODES


def icao_only_country_name(code: str) -> str | None:
    """Name for a code that only Doc 9303 defines (ISO 3166-1 has no entry), else None."""
    return _ICAO_ONLY_CODES.get(code.upper())


def check_digit(field: str) -> str:
    """Compute the Doc 9303 check digit: weights 7, 3, 1 over digit and letter values."""
    total = 0
    for position, char in enumerate(field):
        if char == "<":
            value = 0
        elif char in string.digits:
            value = int(char)
        elif char in string.ascii_uppercase:
            value = ord(char) - ord("A") + 10
        else:
            raise ValueError(f"character not allowed in an MRZ field: {char!r}")
        total += value * _CHECK_DIGIT_WEIGHTS[position % 3]
    return str(total % 10)


def _is_filler(field: str) -> bool:
    return set(field) <= {"<"}


def _is_valid_date(yymmdd: str) -> bool:
    """Calendar check on YYMMDD. The century is unknown, so leap years follow 20YY."""
    if len(yymmdd) != 6 or not yymmdd.isdigit():
        return False
    year, month, day = 2000 + int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    return 1 <= month <= 12 and 1 <= day <= calendar.monthrange(year, month)[1]


def _split_name(identifier: str) -> tuple[str, str, bool] | None:
    """
    Split the name field into (surname, given names, well formed), or None if it has no
    primary identifier or more than two identifiers.

    Primary and secondary identifiers are separated by "<<", words inside one by "<", and
    the field is padded with "<". A name field with only a primary identifier is accepted.
    A name that splits but holds digits or an identifier starting with a filler is returned
    as not well formed, so OCR noise still yields a best-effort name.
    """
    parts = identifier.rstrip("<").split("<<")
    if len(parts) > 2 or not all(parts):
        return None
    well_formed = not any(char.isdigit() for char in identifier) and not any(
        part.startswith("<") for part in parts
    )
    given = parts[1].replace("<", " ") if len(parts) == 2 else ""
    return parts[0].replace("<", " "), given, well_formed


def _check_digits_match(line2: str) -> bool:
    document_number, document_number_check = line2[0:9], line2[9]
    birth_date, birth_date_check = line2[13:19], line2[19]
    expiry_date, expiry_date_check = line2[21:27], line2[27]
    personal_number, personal_number_check = line2[28:42], line2[42]

    # Doc 9303 allows "<" or "0" as the check digit of an empty personal number.
    personal_ok = personal_number_check == check_digit(personal_number) or (
        _is_filler(personal_number) and personal_number_check == "<"
    )
    composite = line2[0:10] + line2[13:20] + line2[21:43]
    return (
        document_number_check == check_digit(document_number)
        and birth_date_check == check_digit(birth_date)
        and expiry_date_check == check_digit(expiry_date)
        and personal_ok
        and line2[43] == check_digit(composite)
    )


def parse_td3(line1: str, line2: str) -> Td3Mrz | None:
    """
    Parse the two lines of a TD3 MRZ.

    Returns None when the lines are not two 44-character strings from [A-Z0-9<]; OCR output
    that is not shaped like an MRZ has no fields to report. Otherwise returns the fields,
    with `valid` set only when every field and every check digit conforms to Doc 9303.
    """
    if (
        len(line1) != TD3_LINE_LENGTH
        or len(line2) != TD3_LINE_LENGTH
        or not _MRZ_CHARSET.issuperset(line1 + line2)
    ):
        return None

    issuing_state = line1[2:5].rstrip("<")
    name = _split_name(line1[5:44])
    document_number = line2[0:9]
    nationality = line2[10:13].rstrip("<")
    sex = line2[20]

    valid = (
        line1[0] == "P"
        and is_icao_country_code(issuing_state)
        and name is not None
        and name[2]
        and not document_number.startswith("<")
        and is_icao_country_code(nationality)
        and _is_valid_date(line2[13:19])
        and _is_valid_date(line2[21:27])
        and sex in _SEX_MARKERS
        and _check_digits_match(line2)
    )

    return Td3Mrz(
        document_type=line1[0:2].rstrip("<"),
        issuing_state=issuing_state,
        surname=name[0] if name else None,
        given_names=(name[1] or None) if name else None,
        document_number=document_number.strip("<"),
        nationality=nationality,
        birth_date=line2[13:19],
        sex=sex,
        expiry_date=line2[21:27],
        personal_number=line2[28:42].strip("<"),
        valid=valid,
    )

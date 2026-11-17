"""
Tests for the ICAO Doc 9303 TD3 (passport) MRZ parser and check digit validator.

The worked examples come from ICAO Doc 9303: the Part 3 check digit examples and the
Part 4 TD3 specimen (ERIKSSON, ANNA MARIA, issued by the fictitious State "UTO").
"""

import pytest

from ocr_service.services.mrz import (
    Td3Mrz,
    check_digit,
    icao_only_country_name,
    is_icao_country_code,
    parse_td3,
)

# Doc 9303 Part 4 TD3 specimen
SPECIMEN_LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
SPECIMEN_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10"


def build_line2(
    document_number: str = "L898902C3",
    nationality: str = "UTO",
    birth_date: str = "740812",
    sex: str = "F",
    expiry_date: str = "120415",
    personal_number: str = "ZE184226B<<<<<",
    personal_number_check: str | None = None,
) -> str:
    """Assemble line 2 with correct check digits, so a test can break one field at a time."""
    document_number = document_number.ljust(9, "<")
    personal_number = personal_number.ljust(14, "<")
    if personal_number_check is None:
        personal_number_check = check_digit(personal_number)
    body = (
        document_number
        + check_digit(document_number)
        + nationality.ljust(3, "<")
        + birth_date
        + check_digit(birth_date)
        + sex
        + expiry_date
        + check_digit(expiry_date)
        + personal_number
        + personal_number_check
    )
    composite = body[0:10] + body[13:20] + body[21:43]
    return body + check_digit(composite)


def build_line1(
    document_code: str = "P<", issuing_state: str = "UTO", name: str = "ERIKSSON<<ANNA<MARIA"
) -> str:
    return (document_code + issuing_state.ljust(3, "<") + name).ljust(44, "<")


def parse(line1: str = SPECIMEN_LINE1, line2: str = SPECIMEN_LINE2) -> Td3Mrz:
    mrz = parse_td3(line1, line2)
    assert mrz is not None
    return mrz


class TestCheckDigit:
    def test_part3_date_example(self):
        """Doc 9303 Part 3 section 4.9: the date 27 July 1952 (520727) has check digit 3."""
        assert check_digit("520727") == "3"

    def test_part3_document_number_example(self):
        """Doc 9303 Part 3 section 4.9: a document number with letters and fillers."""
        assert check_digit("AB2134<<<") == "5"

    @pytest.mark.parametrize(
        ("field", "expected"),
        [
            ("L898902C3", "6"),
            ("740812", "2"),
            ("120415", "9"),
            ("ZE184226B<<<<<", "1"),
            ("L898902C36" + "740812" + "2" + "120415" + "9" + "ZE184226B<<<<<" + "1", "0"),
        ],
    )
    def test_specimen_fields(self, field, expected):
        assert check_digit(field) == expected

    def test_filler_counts_as_zero(self):
        assert check_digit("<<<<<<<<<<<<<<") == "0"
        assert check_digit("A<<") == check_digit("A00")

    def test_empty_field(self):
        assert check_digit("") == "0"

    @pytest.mark.parametrize("field", ["abc", "A B", "AB-1", "É"])
    def test_rejects_characters_outside_the_mrz_set(self, field):
        with pytest.raises(ValueError, match="not allowed"):
            check_digit(field)


class TestParseSpecimen:
    def test_fields(self):
        mrz = parse()

        assert mrz.valid is True
        assert mrz.document_type == "P"
        assert mrz.issuing_state == "UTO"
        assert mrz.surname == "ERIKSSON"
        assert mrz.given_names == "ANNA MARIA"
        assert mrz.document_number == "L898902C3"
        assert mrz.nationality == "UTO"
        assert mrz.birth_date == "740812"
        assert mrz.sex == "F"
        assert mrz.expiry_date == "120415"
        assert mrz.personal_number == "ZE184226B"

    def test_builder_reproduces_the_specimen(self):
        assert build_line1() == SPECIMEN_LINE1
        assert build_line2() == SPECIMEN_LINE2


class TestCheckDigitsInParse:
    @pytest.mark.parametrize(
        ("position", "name"),
        [
            (9, "document number"),
            (19, "date of birth"),
            (27, "date of expiry"),
            (42, "personal number"),
            (43, "composite"),
        ],
    )
    def test_each_wrong_check_digit_invalidates(self, position, name):
        digit = SPECIMEN_LINE2[position]
        wrong = str((int(digit) + 1) % 10)
        line2 = SPECIMEN_LINE2[:position] + wrong + SPECIMEN_LINE2[position + 1 :]

        mrz = parse(line2=line2)

        assert mrz.valid is False, name
        assert mrz.surname == "ERIKSSON"
        assert mrz.document_number == "L898902C3"

    def test_a_changed_field_breaks_its_check_digit(self):
        line2 = SPECIMEN_LINE2.replace("L898902C3", "L898902C4")

        assert parse(line2=line2).valid is False

    @pytest.mark.parametrize("check", ["<", "0"])
    def test_empty_personal_number_accepts_filler_or_zero_check_digit(self, check):
        line2 = build_line2(personal_number="", personal_number_check=check)

        assert parse(line2=line2).valid is True

    @pytest.mark.parametrize("check", ["1", "7", "9"])
    def test_empty_personal_number_rejects_other_check_digits(self, check):
        line2 = build_line2(personal_number="", personal_number_check=check)

        assert parse(line2=line2).valid is False

    def test_non_empty_personal_number_needs_its_digit(self):
        line2 = build_line2(personal_number_check="<")

        assert parse(line2=line2).valid is False


class TestCountryCodes:
    def test_germany_uses_d(self):
        line1 = build_line1(issuing_state="D", name="MUSTERMANN<<ERIKA")
        line2 = build_line2(nationality="D")

        mrz = parse(line1, line2)

        assert mrz.valid is True
        assert mrz.issuing_state == "D"
        assert mrz.nationality == "D"

    def test_iso_code_for_germany_is_not_an_mrz_code(self):
        assert parse(line1=build_line1(issuing_state="DEU")).valid is False
        assert parse(line2=build_line2(nationality="DEU")).valid is False

    def test_unknown_issuing_state_is_invalid(self):
        assert parse(line1=build_line1(issuing_state="UT0")).valid is False

    def test_unknown_nationality_is_invalid(self):
        assert parse(line2=build_line2(nationality="UT0")).valid is False

    def test_blank_nationality_is_invalid(self):
        assert parse(line2=build_line2(nationality="")).valid is False

    @pytest.mark.parametrize("code", ["USA", "DOM", "FRA", "GBR", "UTO", "D", "RKS", "XXA", "utO"])
    def test_known_codes(self, code):
        assert is_icao_country_code(code) is True

    @pytest.mark.parametrize("code", ["", "DEU", "XKX", "XYZ", "D0M", "AB", "O"])
    def test_unknown_codes(self, code):
        assert is_icao_country_code(code) is False

    def test_icao_only_names(self):
        assert icao_only_country_name("D") == "Germany"
        assert icao_only_country_name("utO") == "Utopia"
        assert icao_only_country_name("XXB") == "Refugee B"

    def test_iso_codes_have_no_icao_only_name(self):
        assert icao_only_country_name("USA") is None
        assert icao_only_country_name("DEU") is None


class TestDocumentCode:
    def test_passport_with_country_specific_second_character(self):
        assert parse(line1=build_line1(document_code="PD")).valid is True

    @pytest.mark.parametrize("code", ["V<", "I<", "A<", "<<"])
    def test_non_passport_document_codes_are_invalid(self, code):
        assert parse(line1=build_line1(document_code=code)).valid is False


class TestDates:
    @pytest.mark.parametrize("birth", ["000229", "041231", "990101", "680229"])
    def test_valid_dates(self, birth):
        assert parse(line2=build_line2(birth_date=birth)).valid is True

    @pytest.mark.parametrize("birth", ["740230", "010229", "741301", "740012", "740800", "7408A2"])
    def test_calendar_errors_invalidate(self, birth):
        assert parse(line2=build_line2(birth_date=birth)).valid is False

    def test_expiry_date_is_checked_too(self):
        assert parse(line2=build_line2(expiry_date="120431")).valid is False

    def test_filler_date_is_invalid(self):
        assert parse(line2=build_line2(birth_date="<<<<<<")).valid is False


class TestSex:
    @pytest.mark.parametrize("sex", ["M", "F", "X", "<"])
    def test_allowed_markers(self, sex):
        assert parse(line2=build_line2(sex=sex)).valid is True

    @pytest.mark.parametrize("sex", ["Z", "0", "1", "N"])
    def test_other_markers_are_invalid(self, sex):
        mrz = parse(line2=build_line2(sex=sex))

        assert mrz.valid is False
        assert mrz.sex == sex


class TestDocumentNumber:
    def test_leading_filler_is_invalid(self):
        assert parse(line2=build_line2(document_number="<L898902C")).valid is False

    def test_blank_document_number_is_invalid(self):
        assert parse(line2=build_line2(document_number="")).valid is False

    def test_short_document_number_is_stripped_of_fillers(self):
        mrz = parse(line2=build_line2(document_number="AB2134"))

        assert mrz.valid is True
        assert mrz.document_number == "AB2134"


class TestNameField:
    def test_single_primary_identifier(self):
        mrz = parse(line1=build_line1(name="MONONYM"))

        assert mrz.valid is True
        assert mrz.surname == "MONONYM"
        assert mrz.given_names is None

    def test_words_inside_an_identifier_become_spaces(self):
        mrz = parse(line1=build_line1(name="DE<LA<CRUZ<<MARIA<DEL<CARMEN"))

        assert mrz.valid is True
        assert mrz.surname == "DE LA CRUZ"
        assert mrz.given_names == "MARIA DEL CARMEN"

    def test_name_filling_the_whole_field(self):
        name = "A" * 20 + "<<" + "B" * 17
        mrz = parse(line1=build_line1(name=name))

        assert mrz.valid is True
        assert mrz.given_names == "B" * 17

    def test_digits_keep_the_name_but_invalidate(self):
        """OCR often reads O as 0; the name is still reported so callers can show it."""
        mrz = parse(line1=build_line1(name="ERIKSS0N<<ANNA<MARIA"))

        assert mrz.valid is False
        assert mrz.surname == "ERIKSS0N"
        assert mrz.given_names == "ANNA MARIA"

    def test_identifier_starting_with_a_filler_is_invalid(self):
        assert parse(line1=build_line1(name="ERIKSSON<<<ANNA")).valid is False

    @pytest.mark.parametrize("name", ["", "<<ANNA", "A<<B<<C"])
    def test_unsplittable_names_have_no_name_fields(self, name):
        mrz = parse(line1=build_line1(name=name))

        assert mrz.valid is False
        assert mrz.surname is None
        assert mrz.given_names is None


class TestShape:
    @pytest.mark.parametrize(
        ("line1", "line2"),
        [
            (SPECIMEN_LINE1[:43], SPECIMEN_LINE2),
            (SPECIMEN_LINE1, SPECIMEN_LINE2[:43]),
            (SPECIMEN_LINE1 + "<", SPECIMEN_LINE2),
            (SPECIMEN_LINE1, SPECIMEN_LINE2 + "<"),
            (SPECIMEN_LINE1[:43], SPECIMEN_LINE2 + "<"),
            ("", ""),
        ],
    )
    def test_lines_must_be_44_characters(self, line1, line2):
        assert parse_td3(line1, line2) is None

    @pytest.mark.parametrize(
        ("line1", "line2"),
        [
            (SPECIMEN_LINE1.replace("ERIKSSON", "Eriksson"), SPECIMEN_LINE2),
            (SPECIMEN_LINE1, SPECIMEN_LINE2.replace("ZE184226B", "ZE1842 6B")),
            (SPECIMEN_LINE1.replace("<<ANNA", "<<ANN\r"), SPECIMEN_LINE2),
            (SPECIMEN_LINE1.replace("ERIKSSON", "ERIKSSÖN"), SPECIMEN_LINE2),
        ],
    )
    def test_characters_must_be_uppercase_letters_digits_or_fillers(self, line1, line2):
        assert parse_td3(line1, line2) is None

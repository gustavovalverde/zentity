# OCR Service

Privacy-preserving document OCR and field extraction using RapidOCR with PPOCRv5.

## Overview

This service extracts identity information from documents (national IDs, passports, driver's licenses) and generates cryptographic commitments. Documents are processed transiently and **NEVER stored**.

### Key Capabilities

- **Multi-Country Support**: Automatically detects and validates documents from 30+ countries
- **Dynamic Validation**: Uses [python-stdnum](https://github.com/arthurdejong/python-stdnum) for country-specific document number validation
- **Privacy-First**: Only cryptographic commitments are returned for storage
- **Rich Error Messages**: User-friendly validation feedback for invalid documents

---

## How It Works

### Processing Pipeline

```text
┌─────────────────┐
│  Document Image │
│   (Base64)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  1. OCR Engine  │  RapidOCR with PPOCRv5
│  Text Extraction│  Extracts all visible text
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Document     │  Identifies: passport, national_id, drivers_license
│ Type Detection  │  Based on keywords and patterns
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Country      │  Detects origin country from document text
│ Inference       │  e.g., "REPUBLICA DOMINICANA" → DOM
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Field        │  Extracts: name, DOB, document number, etc.
│ Extraction      │  Uses document-type-specific patterns
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. Dynamic      │  Discovers validator for detected country
│ Validation      │  Uses stdnum.get_cc_module()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 6. Cryptographic│  SHA256 commitments for privacy
│ Commitments     │  (optional, /process endpoint only)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Response     │
│ + Rich Errors   │
└─────────────────┘
```

---

## Country Detection & Inference

The service automatically detects the document's country of origin by scanning the OCR text for country-specific markers.

### How Country Detection Works

1. **Text Scanning**: After OCR extraction, the full text is scanned for country markers
2. **Pattern Matching**: Regex patterns identify country-specific text
3. **ISO Code Assignment**: Detected country is assigned its ISO 3166-1 alpha-3 code

### Country Markers (Examples)

| Country | ISO Code | Detection Patterns |
|---------|----------|-------------------|
| Dominican Republic | `DOM` | `REPÚBLICA DOMINICANA`, `REPUBLICA DOMINICANA`, `REP. DOM` |
| Spain | `ESP` | `ESPAÑA`, `SPAIN`, `REINO DE ESPAÑA` |
| Mexico | `MEX` | `MÉXICO`, `MEXICO`, `ESTADOS UNIDOS MEXICANOS` |
| United States | `USA` | `UNITED STATES`, `U.S.A.` |
| France | `FRA` | `RÉPUBLIQUE FRANÇAISE`, `FRANCE` |
| Germany | `DEU` | `BUNDESREPUBLIK DEUTSCHLAND`, `GERMANY` |

### Country Code Conversion

The service uses ISO 3166 country codes throughout:

- **Alpha-3** (e.g., `DOM`, `ESP`): Used in API responses
- **Alpha-2** (e.g., `do`, `es`): Used internally for stdnum validator lookup

```python
# Example: DOM → do for stdnum lookup
from iso3166 import countries
alpha2 = countries.get("DOM").alpha2.lower()  # Returns "do"
```

---

## Dynamic Validator Discovery

Instead of hardcoding validators for specific countries, the service **dynamically discovers** the appropriate validator at runtime.

### How It Works

```python
from stdnum import get_cc_module

# Dynamically get the Dominican cedula validator
validator = get_cc_module('do', 'cedula')
validator.validate('00113918205')  # Validates with Luhn checksum
```

### Discovery Process

1. **Convert Country Code**: `DOM` → `do` (alpha-3 to alpha-2)
2. **Try Module Names**: Iterate through common personal ID module names:

   ```text
   personalid, cedula, dni, cpf, curp, rut, nie, nif, pesel,
   bsn, personnummer, hetu, nino, ssn, sin, aadhaar, ...
   ```

3. **Return First Match**: First module with a `validate()` function is used
4. **Graceful Fallback**: If no validator found, validation is skipped (not failed)

### Benefits

- **Zero Maintenance**: New countries are supported automatically when stdnum adds them
- **30+ Countries**: Compared to hardcoded support for just 7 countries
- **Proper Checksums**: Each validator includes country-specific checksum algorithms

---

## Document Type Detection

The service identifies document types based on keywords and patterns in the OCR text.

### Detection Logic

| Document Type | Detection Patterns |
|--------------|-------------------|
| **Passport** | `PASAPORTE`, `PASSPORT`, MRZ pattern (`P<XXX...`) |
| **National ID** | `CEDULA`, `DNI`, `NATIONAL ID`, `CARTE D'IDENTITÉ`, country-specific formats |
| **Driver's License** | `LICENCIA DE CONDUCIR`, `DRIVER LICENSE`, `PERMIS DE CONDUIRE` |

### Confidence Scoring

Each detection includes a confidence score based on:

- Number of matching patterns found
- OCR confidence levels
- Number of fields successfully extracted

---

## Field Extraction

### National IDs

Fields are extracted using multilingual regex patterns:

| Field | Patterns Tried |
|-------|---------------|
| **First Name** | `NOMBRE(S):`, `GIVEN NAME:`, `FIRST NAME:`, `PRÉNOM:` |
| **Last Name** | `APELLIDO(S):`, `SURNAME:`, `LAST NAME:`, `NOM:` |
| **Date of Birth** | `FECHA NAC:`, `DATE OF BIRTH:`, `DOB:`, `BORN:` |
| **Document Number** | Country-specific formats (cedula, DNI, etc.) |
| **Expiration** | `VENCE:`, `EXPIRA:`, `EXPIRY:`, `VALID UNTIL:` |

### Passports (MRZ Parsing)

Passports are parsed using the **MRZ (Machine Readable Zone)** following [ICAO 9303](https://www.icao.int/publications/pages/publication.aspx?docnum=9303) standard.

```text
P<DOMPEREZ<<JUAN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
AB12345670DOM9005156M2512310<<<<<<<<<<<<<<00
  ^^^       ^^^
  |         |__ Nationality (positions 3-5 of line 1, after "P<")
  |__ Issuing Country (positions 3-5 of line 2)
```

The `mrz` library extracts:

- Surname and given names
- Document number with checksum validation
- **Issuing country** (separate from nationality - useful for fraud detection)
- Nationality (with OCR error correction)
- Date of birth
- Expiration date
- Gender

**Note:** Issuing country and nationality are typically the same but can differ (e.g., dual citizens). A mismatch can indicate document fraud.

#### MRZ OCR Error Correction

Common OCR mistakes in country codes are automatically corrected:

- `0` ↔ `O` (zero vs letter O)
- `1` ↔ `I` (one vs letter I)
- `5` ↔ `S` (five vs letter S)

---

## Document Number Validation

### Validation Results

Each validation returns rich error information:

```python
@dataclass
class ValidationResult:
    is_valid: bool
    error_code: str          # Machine-readable: "invalid_document_checksum"
    error_message: str       # Human-readable for UI display
    validator_used: str      # e.g., "stdnum.do.cedula"
    format_name: str         # e.g., "cedula (Dominican Republic national ID)"
```

### Error Types

| Error Code | Description | Example Message |
|------------|-------------|-----------------|
| `invalid_document_checksum` | Check digit failed | "The document number appears to be invalid for Dominican Republic. The check digit doesn't match what's expected for a cedula." |
| `invalid_document_length` | Wrong number of digits | "The document number has an incorrect length for Spain. A valid DNI should have 8 digits followed by a letter." |
| `invalid_document_format` | Invalid characters/format | "The document number format is incorrect for Mexico. A CURP should contain 18 alphanumeric characters." |
| `validation_unavailable_for_country` | No validator exists | "Document validation is not available for Germany. The document number format could not be verified." |

### API Response with Validation Details

```json
{
  "documentType": "national_id",
  "documentOrigin": "DOM",
  "validationIssues": ["invalid_document_checksum"],
  "validationDetails": [{
    "errorCode": "invalid_document_checksum",
    "errorMessage": "The document number appears to be invalid for Dominican Republic. The check digit doesn't match what's expected for a cedula (Dominican Republic national ID). Please verify you entered the number correctly.",
    "validatorUsed": "stdnum.do.cedula",
    "formatName": "cedula (Dominican Republic national ID)"
  }]
}
```

---

## Supported Countries

### Countries with Document Number Validation

The service can validate document numbers for these countries using `python-stdnum`:

| Region | Countries |
|--------|-----------|
| **Americas** | Argentina (DNI), Brazil (CPF), Chile (RUT), Colombia (NIT), Costa Rica, Cuba, Dominican Republic (Cedula), Ecuador, Mexico (CURP), Peru |
| **Europe** | Belgium, Bulgaria (EGN), Denmark (CPR), Estonia, Finland (HETU), France, Greece (AMKA), Iceland (Kennitala), Italy, Lithuania, Netherlands (BSN), Norway, Poland (PESEL), Portugal, Romania (CNP), Spain (DNI/NIE), Sweden (Personnummer), Turkey, Ukraine |
| **Asia-Pacific** | Australia (TFN), India (Aadhaar), Israel, Japan, South Korea |
| **Other** | South Africa |

### Countries with Detection Only

For countries without a stdnum validator, the service will:

1. ✅ Detect the country from document text
2. ✅ Extract fields (name, DOB, etc.)
3. ⚠️ Return `validation_unavailable_for_country` warning
4. ✅ Continue processing (not blocked)

---

## Technology Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| **OCR Engine** | [RapidOCR](https://github.com/RapidAI/RapidOCR) | Text extraction with PPOCRv5 |
| **Web Framework** | [FastAPI](https://fastapi.tiangolo.com/) | REST API |
| **Document Validation** | [python-stdnum](https://github.com/arthurdejong/python-stdnum) | 200+ ID format validators |
| **MRZ Parsing** | [mrz](https://pypi.org/project/mrz/) | ICAO 9303 passport parsing |
| **Country Codes** | [iso3166](https://pypi.org/project/iso3166/) | ISO 3166 country lookups |
| **Image Processing** | OpenCV, Pillow | Image preprocessing |

---

## Privacy Guarantees

### Zero Storage Policy

- Document images are **never written to disk**
- All processing happens **in-memory only**
- PII is **discarded immediately** after response

### Cryptographic Commitments

For the `/process` endpoint, the service generates privacy-preserving commitments:

```text
Document Hash:            SHA256(normalize(doc_number) + ":" + user_salt)
Name Commitment:          SHA256(normalize(full_name) + ":" + user_salt)
Nationality Commitment:   SHA256(normalize(nationality_code) + ":" + user_salt)
Issuing Country Commitment: SHA256(normalize(issuing_country_code) + ":" + user_salt)
```

**What gets stored (safe):**

- Document hash (cannot reverse to get actual number)
- Name commitment (cannot reverse to get actual name)
- Nationality commitment (for later ZK proof verification)
- Issuing country commitment (for fraud detection - mismatch with nationality)
- User salt (enables verification)

**Note:** The web app reduces `document_hash` into a field element to bind ZK proofs via `claim_hash`.

**What gets discarded (PII):**

- Original document image
- Extracted name, DOB, document number
- All OCR text

### GDPR Right to Erasure

```text
DELETE user_salt → All commitments become unlinkable
```

When a user requests deletion, removing their salt orphans all their commitments, making them cryptographically useless.

---

## API Reference

### `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "service": "ocr-service",
  "version": "1.0.0",
  "uptimeSeconds": 3600.5
}
```

---

### `POST /extract`

Raw OCR text extraction without parsing.

**Request:**

```json
{
  "image": "base64-encoded-image"
}
```

**Response:**

```json
{
  "textBlocks": [
    { "text": "REPUBLICA DOMINICANA", "confidence": 0.95, "bbox": [10, 20, 200, 50] }
  ],
  "fullText": "REPUBLICA DOMINICANA\nCEDULA DE IDENTIDAD...",
  "processingTimeMs": 450
}
```

---

### `POST /ocr`

Full document OCR with field extraction and validation.

**Request:**

```json
{
  "image": "base64-encoded-image"
}
```

**Response:**

```json
{
  "documentType": "national_id",
  "documentOrigin": "DOM",
  "confidence": 0.87,
  "extractedData": {
    "fullName": "JUAN PEREZ",
    "firstName": "JUAN",
    "lastName": "PEREZ",
    "documentNumber": "001-0000000-0",
    "dateOfBirth": "1990-05-15",
    "expirationDate": "2025-12-31",
    "nationality": "Dominican Republic",
    "nationalityCode": "DOM",
    "gender": "M"
  },
  "validationIssues": [],
  "validationDetails": null,
  "processingTimeMs": 520
}
```

**With Validation Errors:**

```json
{
  "documentType": "national_id",
  "documentOrigin": "DOM",
  "confidence": 0.87,
  "extractedData": { ... },
  "validationIssues": ["invalid_document_checksum"],
  "validationDetails": [{
    "errorCode": "invalid_document_checksum",
    "errorMessage": "The document number appears to be invalid for Dominican Republic. The check digit doesn't match what's expected for a cedula (Dominican Republic national ID). Please verify you entered the number correctly.",
    "validatorUsed": "stdnum.do.cedula",
    "formatName": "cedula (Dominican Republic national ID)"
  }],
  "processingTimeMs": 520
}
```

---

### `POST /process`

Privacy-preserving document processing (recommended for production).

**Request:**

```json
{
  "image": "base64-encoded-image",
  "userSalt": "optional-existing-salt"
}
```

**Response:**

```json
{
  "commitments": {
    "documentHash": "a1b2c3d4e5f6...",
    "nameCommitment": "f6e5d4c3b2a1...",
    "userSalt": "random-32-bytes-hex"
  },
  "documentType": "national_id",
  "documentOrigin": "DOM",
  "confidence": 0.87,
  "extractedData": {
    "fullName": "JUAN PEREZ",
    "dateOfBirth": "1990-05-15",
    "nationality": "Dominican Republic",
    "nationalityCode": "DOM"
  },
  "validationIssues": [],
  "validationDetails": null,
  "processingTimeMs": 550
}
```

> **Important:** The `extractedData` is for UI display only. Callers MUST discard it after use and store only the `commitments`.

---

### `POST /verify-name`

Verify a name claim against a stored commitment.

**Request:**

```json
{
  "claimedName": "Juan Perez",
  "storedCommitment": "f6e5d4c3b2a1...",
  "userSalt": "user-salt-hex"
}
```

**Response:**

```json
{
  "matches": true
}
```

---

## Validation Rules

### Document Number Validation

| Check | Description |
|-------|-------------|
| **Country-specific format** | Validates against stdnum if available |
| **Checksum verification** | Luhn, modulo, or country-specific algorithm |
| **Length validation** | Correct number of digits/characters |

### Date Validation

| Check | Description |
|-------|-------------|
| **Expiration** | Document not expired |
| **Date of Birth** | Age between 0-150 years |
| **Minor Detection** | Flags if age < 18 |

### Passport MRZ Validation

| Check | Description |
|-------|-------------|
| **Line checksums** | Each MRZ line has check digits |
| **Composite checksum** | Overall MRZ integrity |
| **Country code** | Valid ISO 3166 code |

---

## Development

### Prerequisites

- Python 3.10+
- pip

### Installation

```bash
cd apps/ocr
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e '.[test]'
```

### Running Locally

```bash
PYTHONPATH=src uvicorn ocr_service.main:app --port 5004 --reload
```

### Runtime Dependencies

Production images install from the pinned lockfile:

```bash
pip install -r requirements.lock
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5004` | Service port |

---

## Docker

```bash
# Build
docker build -t zentity-ocr-service .

# Run
docker run -p 5004:5004 zentity-ocr-service
```

---

## Architecture

```text
apps/ocr/
├── src/ocr_service/
│   ├── main.py              # FastAPI application factory
│   ├── schemas.py           # API request/response models
│   ├── api/                 # Route handlers
│   ├── services/            # OCR + parsing + validation pipeline
│   └── core/                # Settings/auth helpers
├── pyproject.toml
├── requirements.lock
├── Dockerfile
└── README.md
```

### Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `main.py` | App factory and wiring |
| `schemas.py` | API request/response models |
| `api/` | Route handlers |
| `services/` | OCR, parsing, validation, commitments |
| `core/` | Settings + auth middleware |

---

## Error Handling

### Validation Issues

All validation issues are returned in `validationIssues` array:

| Issue Code | Description |
|------------|-------------|
| `ocr_failed` | OCR engine error |
| `no_text_detected` | No readable text in image |
| `mrz_checksum_invalid` | Passport MRZ failed checksum |
| `invalid_document_checksum` | Document number checksum failed |
| `invalid_document_length` | Wrong number of digits |
| `invalid_document_format` | Invalid format/characters |
| `validation_unavailable_for_country` | No validator for this country |
| `document_expired` | Document past expiration date |
| `invalid_date_of_birth` | Unreasonable DOB |
| `minor_age_detected` | Person is under 18 |
| `missing_document_number` | Could not extract document number |
| `missing_full_name` | Could not extract name |

---

## Contributing

When adding support for new document types or countries:

1. **Country Detection**: Add patterns to `COUNTRY_MARKERS` in `parser.py`
2. **Field Extraction**: Add regex patterns to `NATIONAL_ID_PATTERNS` in `parser.py`
3. **Validation**: If stdnum doesn't support the country, validation is automatically skipped

No code changes needed for countries already in stdnum - they're discovered automatically!

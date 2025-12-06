# OCR Service

Privacy-preserving document OCR and field extraction using RapidOCR with PPOCRv5.

## Overview

This service extracts identity information from documents (cedula, passport, driver's license) and generates cryptographic commitments. Documents are processed transiently and NEVER stored.

## Technology

- **Language**: Python 3.10+
- **Framework**: FastAPI
- **OCR Engine**: RapidOCR (PPOCRv5 for Latin languages)
- **Port**: 5004

## Privacy Guarantees

- Document images processed transiently
- Only cryptographic commitments returned for storage
- PII discarded after processing
- Follows zkKYC principles

## Supported Documents

| Document Type | Country | Fields Extracted |
|---------------|---------|------------------|
| Cedula | Dominican Republic | Name, DOB, Document #, Expiry |
| Passport | International | Name, DOB, Passport #, Nationality, Expiry |
| Driver's License | Dominican Republic | Name, DOB, License #, Expiry |

## Endpoints

### `GET /health`
Service health check.

### `POST /extract`
Raw OCR text extraction.

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
    { "text": "REPUBLICA DOMINICANA", "confidence": 0.95, "bbox": [...] }
  ],
  "fullText": "REPUBLICA DOMINICANA...",
  "processingTimeMs": 450
}
```

### `POST /ocr`
Full document OCR with field parsing.

**Response:**
```json
{
  "documentType": "cedula",
  "isValidDRDocument": true,
  "confidence": 0.87,
  "extractedData": {
    "fullName": "JUAN PEREZ",
    "firstName": "JUAN",
    "lastName": "PEREZ",
    "documentNumber": "001-0000000-0",
    "dateOfBirth": "1990-05-15",
    "expirationDate": "2025-12-31",
    "nationality": "DOM"
  },
  "validationIssues": [],
  "processingTimeMs": 520
}
```

### `POST /process`
Privacy-preserving document processing (recommended).

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
    "documentHash": "sha256-hash",
    "nameCommitment": "sha256-hash",
    "userSalt": "random-32-bytes"
  },
  "documentType": "cedula",
  "isValidDRDocument": true,
  "confidence": 0.87,
  "extractedData": {
    "fullName": "JUAN PEREZ",
    "dateOfBirth": "1990-05-15"
  },
  "validationIssues": [],
  "processingTimeMs": 550
}
```

**Important:** The `extractedData` is for UI display only. The caller MUST discard it after use and store only the `commitments`.

### `POST /verify-name`
Verify a name claim against stored commitment.

**Request:**
```json
{
  "claimedName": "Juan Perez",
  "storedCommitment": "sha256-hash",
  "userSalt": "user-salt"
}
```

**Response:**
```json
{
  "matches": true
}
```

## Cryptographic Commitments

### Document Hash
```
hash = SHA256(normalize(doc_number) + ":" + user_salt)
Purpose: Detect duplicate documents without storing actual number
```

### Name Commitment
```
commitment = SHA256(normalize(full_name) + ":" + user_salt)
Purpose: Verify name claims without storing actual name
Normalization: Uppercase, remove accents, collapse whitespace
```

### GDPR Erasure
```
DELETE user_salt → All commitments become unlinkable
User can re-verify with new salt, old records orphaned
```

## Development

### Prerequisites
- Python 3.10+
- pip

### Install
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Run
```bash
uvicorn app.main:app --port 5004 --reload
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5004 | Service port |

## Docker

```bash
docker build -t zentity-ocr-service .
docker run -p 5004:5004 zentity-ocr-service
```

## Validation

The service validates:
- Cedula number format (Luhn check digit)
- Passport number format
- Expiration date (not expired)
- Date of birth (reasonable age range)

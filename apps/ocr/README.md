# OCR Service

Privacy-preserving document OCR and field extraction using RapidOCR (PPOCRv5).

## What this service does

- Extracts text and fields from passports, national IDs, and driver's licenses
- Infers document type and issuing country
- Validates document numbers using country-specific rules
- Optionally returns cryptographic commitments for privacy-safe storage

Images are processed **transiently** and are never stored.

## How it works

1. **OCR** extracts text from the image.
2. **Document type detection** identifies passport / national ID / driver's license.
3. **Country inference** determines issuing country.
4. **Field extraction** pulls name, DOB, document number, expiry, etc.
5. **Validation** runs country-specific checks.
6. **Commitments** are generated for privacy-first storage (optional).

## Endpoints

- `GET /health` - service health
- `GET /build-info` - build metadata
- `POST /extract` - raw OCR text
- `POST /ocr` - structured fields + validation
- `POST /process` - structured fields + validation + commitments
- `POST /verify-name` - verify a name against a stored commitment

## Run locally

```bash
pip install -e '.[test]'
PYTHONPATH=src uvicorn ocr_service.main:app --reload --port 5004
```

The service listens on `http://localhost:5004` by default.

## Configuration

- `PORT` - service port (default: `5004`)
- `INTERNAL_SERVICE_TOKEN` - enable internal auth for non-public routes
- `INTERNAL_SERVICE_TOKEN_REQUIRED` - force auth even outside production

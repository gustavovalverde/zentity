# FHE Service

Fully Homomorphic Encryption service for privacy-preserving identity verification using TFHE-rs.

## Overview

This service enables privacy-preserving verification by encrypting sensitive data with Fully Homomorphic Encryption (FHE). Computations can be performed on encrypted data without decryption, ensuring PII never leaves the user's control unencrypted.

### What Gets Encrypted

| Data | Format | Purpose |
|------|--------|---------|
| Birth Year | Integer (e.g., 1990) | Age threshold verification |
| Full DOB | Integer YYYYMMDD (e.g., 19900515) | Precise age calculations |
| Gender | Integer (ISO 5218: 0=unknown, 1=male, 2=female) | Gender-specific verification |
| Liveness Score | Float scaled to int (e.g., 0.85 → 85) | Anti-spoofing threshold checks |

## Technology

- **Language**: Rust
- **Framework**: Axum
- **Crypto Library**: TFHE-rs v1.4.2
- **Port**: 5001

## How It Works

```
1. Client encrypts birth_year → ciphertext
2. Server computes: (current_year - ciphertext) >= min_age
3. Computation happens ON ENCRYPTED DATA
4. Only boolean result is decrypted → is_over_18
5. Birth year NEVER leaves client unencrypted
```

## Endpoints

### `GET /health`
Service health check.

**Response:**
```json
{
  "status": "healthy",
  "service": "fhe-service"
}
```

### `POST /keys/generate`
Generate new FHE key pair for a client.

**Response:**
```json
{
  "keyId": "uuid",
  "publicKey": "base64-encoded-key",
  "generationTimeMs": 450
}
```

### `POST /encrypt`
Encrypt a birth year using FHE.

**Request:**
```json
{
  "birthYear": 1990,
  "publicKey": "base64-encoded-key"
}
```

**Response:**
```json
{
  "ciphertext": "base64-encoded-ciphertext",
  "encryptionTimeMs": 1
}
```

### `POST /verify-age`
Verify age threshold on encrypted birth year.

**Request:**
```json
{
  "ciphertext": "base64-encoded-ciphertext",
  "minAge": 18,
  "currentYear": 2024
}
```

**Response:**
```json
{
  "isOverAge": true,
  "computationTimeMs": 80
}
```

### `POST /encrypt-dob`
Encrypt full date of birth (YYYYMMDD format).

**Request:**
```json
{
  "dateOfBirth": "1990-05-15"
}
```

**Response:**
```json
{
  "ciphertext": "base64-encoded-ciphertext",
  "encryptionTimeMs": 2
}
```

### `POST /encrypt-gender`
Encrypt gender using ISO 5218 encoding.

**Request:**
```json
{
  "gender": "M"
}
```

**Response:**
```json
{
  "ciphertext": "base64-encoded-ciphertext",
  "genderCode": 1,
  "encryptionTimeMs": 1
}
```

Gender codes: `M`/`male` → 1, `F`/`female` → 2, other → 0

### `POST /encrypt-liveness`
Encrypt anti-spoofing liveness score.

**Request:**
```json
{
  "score": 0.85
}
```

**Response:**
```json
{
  "ciphertext": "base64-encoded-ciphertext",
  "scaledScore": 85,
  "encryptionTimeMs": 1
}
```

Score is scaled to integer (0-100) for FHE operations.

## Performance (Apple Silicon)

| Operation | Time |
|-----------|------|
| Key generation | ~450ms |
| Encryption | <1ms |
| Homomorphic ops | ~80ms |
| Decryption | <1ms |

## Development

### Prerequisites
- Rust 1.70+
- Cargo

### Build
```bash
cargo build --release
```

### Run
```bash
cargo run --release
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5001 | Service port |
| `RUST_LOG` | info | Log level |

## Docker

```bash
docker build -t zentity-fhe-service .
docker run -p 5001:5001 zentity-fhe-service
```

## Privacy Guarantees

- Birth year is encrypted on the client side
- Server never sees the plaintext birth year
- Only boolean result (is_over_18) is returned
- Ciphertext is stored, not the actual DOB

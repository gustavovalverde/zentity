# FHE Service

Fully Homomorphic Encryption service for privacy-preserving age verification using TFHE-rs.

## Overview

This service enables age verification without revealing the actual birth year. It uses Fully Homomorphic Encryption (FHE) to perform computations on encrypted data, ensuring that the birth year never leaves the client unencrypted.

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

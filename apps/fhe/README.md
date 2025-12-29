# FHE Service

Fully Homomorphic Encryption service for privacy-preserving compliance checks using TFHE-rs.

## Overview

This service encrypts sensitive attributes with **client-owned keys** and performs homomorphic checks without decryption. Only the user can decrypt results because the client key never leaves the browser.

### What Gets Encrypted

| Data | Format | Purpose |
|------|--------|---------|
| Birth year offset | Integer (years since 1900) | Age threshold checks |
| Country code | ISO 3166-1 numeric (0-999) | Compliance allowlists |
| Compliance level | Integer (0-10) | Tiered verification policies |
| Liveness score | Float (0.0-1.0, scaled to 0-10000) | Anti-spoof threshold checks |

## Key Model (Client-Owned)

1. **Browser generates TFHE keys** via `apps/web/src/lib/crypto/tfhe-browser.ts`
2. **Client key** stays in IndexedDB (never sent to server)
3. **Public + server keys** are sent to the FHE service
4. FHE service returns a **`key_id`** for server-side computations

**Result:** server can compute on ciphertext but cannot decrypt.

## Endpoints

### `GET /health`

Service health check.

### `GET /build-info`

Build metadata for deployment verification.

### `POST /keys/register`

Register a client-generated server key.

**Request:**

```json
{ "serverKey": "base64-encoded-key" }
```

**Response:**

```json
{ "keyId": "uuid" }
```

### `POST /encrypt-birth-year-offset`

Encrypt birth year offset (years since 1900).

**Request:**

```json
{ "birthYearOffset": 90, "publicKey": "base64-encoded-key" }
```

**Response:**

```json
{ "ciphertext": "base64-encoded-ciphertext" }
```

### `POST /verify-age-offset`

Verify age threshold on encrypted birth year offset.

**Request:**

```json
{ "ciphertext": "...", "currentYear": 2025, "minAge": 18, "keyId": "uuid" }
```

**Response:**

```json
{ "resultCiphertext": "base64-encoded-ciphertext" }
```

### `POST /encrypt-country-code`

Encrypt ISO 3166-1 numeric country code.

**Request:**

```json
{ "countryCode": 840, "publicKey": "base64-encoded-key" }
```

**Response:**

```json
{ "ciphertext": "...", "countryCode": 840 }
```

### `POST /encrypt-compliance-level`

Encrypt a compliance tier (0-10).

**Request:**

```json
{ "complianceLevel": 3, "publicKey": "base64-encoded-key" }
```

**Response:**

```json
{ "ciphertext": "...", "complianceLevel": 3 }
```

### `POST /encrypt-liveness`

Encrypt a liveness score (0.0-1.0).

**Request:**

```json
{ "score": 0.85, "publicKey": "base64-encoded-key" }
```

**Response:**

```json
{ "ciphertext": "...", "score": 0.85 }
```

### `POST /verify-liveness-threshold`

Verify a liveness threshold on encrypted score.

**Request:**

```json
{ "ciphertext": "...", "threshold": 0.35, "keyId": "uuid" }
```

**Response:**

```json
{ "passesCiphertext": "base64-encoded-ciphertext", "threshold": 0.35 }
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `INTERNAL_SERVICE_TOKEN` | Require auth for non-public endpoints | (optional) |
| `INTERNAL_SERVICE_TOKEN_REQUIRED` | Force auth even if token missing | `false` |
| `FHE_BODY_LIMIT_MB` | Max request body size (MB) | `64` |
| `FHE_PERSIST_KEYS` | Persist server keys to default disk path | `false` |
| `FHE_KEYS_DIR` | Persist server keys to this directory | (optional) |

## Development

### Prerequisites

- Rust 1.91+
- Cargo

### Build

```bash
cargo build --release
```

### Run

```bash
cargo run
```

The service listens on `http://localhost:5001` by default.

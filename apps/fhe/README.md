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

## Transport (2025+)

All POST endpoints accept **MessagePack** payloads (`application/msgpack`), optionally **gzipped**
(`Content-Encoding: gzip`). Responses are MessagePack as well and will be gzipped when clients send
`Accept-Encoding: gzip`.

This keeps payloads compact (especially public/server keys and ciphertexts) and reduces time spent
serializing JSON.

## Key Model (Client-Owned)

1. **Browser generates TFHE keys** via `apps/web/src/lib/crypto/tfhe-browser.ts`
2. **Client key** stays in IndexedDB (never sent to server)
3. **Public + server keys** are sent to the FHE service (`/keys/register`)
4. FHE service returns a **`key_id`** for server-side computations

**Result:** server can compute on ciphertext but cannot decrypt.

## Endpoints

### `GET /health`

Service health check.

### `GET /build-info`

Build metadata for deployment verification.

### `POST /keys/register`

Register a client-generated server key + public key.

**Request (MessagePack):**

```json
{ "serverKey": "<bytes>", "publicKey": "<bytes>" }
```

**Response (MessagePack):**

```json
{ "keyId": "uuid" }
```

### `POST /encrypt-birth-year-offset`

Encrypt birth year offset (years since 1900).

**Request (MessagePack):**

```json
{ "birthYearOffset": 90, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "ciphertext": "<bytes>" }
```

### `POST /verify-age-offset`

Verify age threshold on encrypted birth year offset.

**Request (MessagePack):**

```json
{ "ciphertext": "...", "currentYear": 2025, "minAge": 18, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "resultCiphertext": "<bytes>" }
```

### `POST /encrypt-country-code`

Encrypt ISO 3166-1 numeric country code.

**Request (MessagePack):**

```json
{ "countryCode": 840, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "ciphertext": "<bytes>", "countryCode": 840 }
```

### `POST /encrypt-compliance-level`

Encrypt a compliance tier (0-10).

**Request (MessagePack):**

```json
{ "complianceLevel": 3, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "ciphertext": "<bytes>", "complianceLevel": 3 }
```

### `POST /encrypt-liveness`

Encrypt a liveness score (0.0-1.0).

**Request (MessagePack):**

```json
{ "score": 0.85, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "ciphertext": "<bytes>", "score": 0.85 }
```

### `POST /verify-liveness-threshold`

Verify a liveness threshold on encrypted score.

**Request (MessagePack):**

```json
{ "ciphertext": "...", "threshold": 0.35, "keyId": "uuid" }
```

**Response (MessagePack):**

```json
{ "passesCiphertext": "<bytes>", "threshold": 0.35 }
```

### `POST /encrypt-batch`

Batch-encrypt multiple attributes in one request to reduce overhead.

**Request (MessagePack):**

```json
{
  "keyId": "uuid",
  "birthYearOffset": 90,
  "countryCode": 840,
  "complianceLevel": 3,
  "livenessScore": 0.85
}
```

**Response (MessagePack):**

```json
{
  "birthYearOffsetCiphertext": "<bytes>",
  "countryCodeCiphertext": "<bytes>",
  "complianceLevelCiphertext": "<bytes>",
  "livenessScoreCiphertext": "<bytes>"
}
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `INTERNAL_SERVICE_TOKEN` | Require auth for non-public endpoints | (optional) |
| `INTERNAL_SERVICE_TOKEN_REQUIRED` | Force auth even if token missing | `false` |
| `FHE_BODY_LIMIT_MB` | Max request body size (MB) | `64` |
| `FHE_KEYS_DIR` | Directory for persisted server keys | `/var/lib/zentity/fhe` |
| `FHE_CONCURRENCY_LIMIT` | Max concurrent requests | CPU count (fallback 4) |
| `FHE_CPU_CONCURRENCY_LIMIT` | Max concurrent CPU-bound tasks | `FHE_CONCURRENCY_LIMIT` |
| `FHE_REQUEST_TIMEOUT_MS` | Request timeout (milliseconds) | `60000` |

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

### Persistence

Server and public keys are persisted in a ReDB database at `$FHE_KEYS_DIR/keystore.redb` (default: `/var/lib/zentity/fhe/keystore.redb`). This enables horizontal scaling and crash recovery without re-registering keys.

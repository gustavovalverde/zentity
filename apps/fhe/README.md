# FHE Service

Fully Homomorphic Encryption (FHE) service used for privacy-preserving compliance checks.

## What this service does

- Encrypts sensitive attributes with **client-owned keys**
- Runs homomorphic checks (age, compliance, liveness) **without decryption**
- Returns ciphertext results that only the user can decrypt

This service is called by `apps/web` and never sees plaintext user data.

## Key model

1. The browser generates TFHE keys.
2. Public + server keys are registered with the service.
3. The service returns a `key_id` used for all FHE computations.

**Result:** the server can compute on ciphertexts but cannot decrypt them.

## Transport

All POST endpoints accept **MessagePack** payloads (`application/msgpack`), optionally **gzipped**. Responses are MessagePack as well and are gzipped when the client advertises `Accept-Encoding: gzip`.

## Endpoints

- `GET /health` - service health
- `GET /build-info` - build metadata
- `POST /keys/register` - register public + server keys
- `POST /encrypt-birth-year-offset`
- `POST /verify-age-offset`
- `POST /encrypt-country-code`
- `POST /encrypt-compliance-level`
- `POST /encrypt-liveness`
- `POST /verify-liveness-threshold`
- `POST /encrypt-batch` - batch encrypt multiple attributes

## Persistence

Public and server keys are persisted in **ReDB** at `$FHE_KEYS_DIR/keystore.redb` (default: `/var/lib/zentity/fhe/keystore.redb`). This enables restart recovery and horizontal scaling without re-registering keys.

## Run locally

```bash
cargo run
```

The service listens on `http://localhost:5001` by default.

## Configuration

- `PORT` - service port (default: `5001`)
- `FHE_KEYS_DIR` - ReDB directory for persisted keys
- `FHE_BODY_LIMIT_MB` - max request body size (default: `64`)
- `INTERNAL_SERVICE_TOKEN` - enable internal auth for non-public routes
- `INTERNAL_SERVICE_TOKEN_REQUIRED` - force auth even outside production

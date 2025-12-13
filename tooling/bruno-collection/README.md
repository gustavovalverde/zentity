# Zentity Services - Bruno Collection

API collection for testing all Zentity backend services.

## Prerequisites

1. Install [Bruno](https://www.usebruno.com/) (open-source API client)
2. Have Docker installed and running

## Quick Start

```bash
# Start all services
docker compose up -d

# Or start specific services:
docker compose up -d fhe-service ocr-service

# Wait for services to be healthy
docker compose ps
```

## Opening the Collection

1. Open Bruno
2. Click "Open Collection"
3. Navigate to `tooling/bruno-collection`
4. Select the "Local" environment (bottom right)

## Services Overview

### FHE Service (Port 5001)
Fully Homomorphic Encryption - compute on encrypted data

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/encrypt` | POST | Encrypt a birth year |
| `/verify-age` | POST | Verify age on encrypted data |

### OCR Service (Port 5004)
Document OCR and data extraction

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/extract` | POST | Extract document data |
| `/commitments` | POST | Generate privacy commitments |

## Zero-Knowledge Proofs

ZK proofs (age verification, document validity, nationality membership) are generated client-side in the browser using Noir.js and Barretenberg (UltraHonk).

The frontend at `http://localhost:3000` handles:
- Age verification proofs
- Document validity proofs
- Nationality group membership proofs (Merkle tree)

## Typical Workflows

### FHE Age Verification
1. Run "FHE Service > Health Check" to confirm service is up
2. Run "FHE Service > Encrypt Birth Year" (with birthYear: 1990)
3. Run "FHE Service > Verify Age" - uses stored ciphertext automatically

### Document OCR
1. Run "OCR Service > Health Check" to confirm service is up
2. Run "OCR Service > Extract" with a document image

## Variables

The collection uses post-response scripts to store data between requests:

| Variable | Set By | Used By |
|----------|--------|---------|
| `encrypted_birth_year` | Encrypt Birth Year | Verify Age |

## Environment Variables

Both environments (Local and Docker) use the same URLs since Docker maps ports to localhost:

- `fhe_base_url`: http://localhost:5001
- `ocr_base_url`: http://localhost:5004

## Performance Expectations

| Operation | Expected Time |
|-----------|---------------|
| FHE Encryption | <1ms |
| FHE Age Check | 80-130ms |
| ZK Age Proof (client-side) | 100-500ms |
| ZK Nationality Proof (client-side) | 200-700ms |

## Troubleshooting

### FHE Service shows "unhealthy"
- Wait 60 seconds after starting - key generation takes time
- Check logs: `docker compose logs fhe-service`

### "Connection refused" errors
- Ensure services are running: `docker compose ps`
- Check if ports are available: `lsof -i :5001 -i :5004`

### Verify Age returns error
- Ensure you ran "Encrypt Birth Year" first
- The ciphertext variable may have expired - re-run encryption

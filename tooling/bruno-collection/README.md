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
docker compose up -d fhe-service zk-service liveness-service ocr-service

# Wait for services to be healthy (liveness may take 30-60s for model download)
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

### ZK Service (Port 5002)
Zero-Knowledge Proofs - prove facts without revealing data

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/generate-proof` | POST | Generate age proof |
| `/verify-proof` | POST | Verify age proof |
| `/nationality/generate` | POST | Generate nationality membership proof |
| `/nationality/verify` | POST | Verify nationality proof |
| `/nationality/groups` | GET | List country groups |

### Liveness Service (Port 5003)
Face detection, liveness verification, and multi-gesture challenges

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/head-pose` | POST | Detect head orientation |
| `/head-turn-check` | POST | Validate head turn direction |
| `/challenge/session` | POST | Create multi-challenge session |
| `/challenge/complete` | POST | Complete a challenge |
| `/challenge/validate-multi` | POST | Batch validate challenges |

### OCR Service (Port 5004)
Document OCR and data extraction

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/extract` | POST | Extract document data |
| `/commitments` | POST | Generate privacy commitments |

## Typical Workflows

### FHE Age Verification
1. Run "FHE Service > Health Check" to confirm service is up
2. Run "FHE Service > Encrypt Birth Year" (with birthYear: 1990)
3. Run "FHE Service > Verify Age" - uses stored ciphertext automatically

### ZK Age Proof
1. Run "ZK Service > Health Check" to confirm service is up
2. Run "ZK Service > Generate Proof" (with birthYear: 1990)
3. Run "ZK Service > Verify Proof" - uses stored proof automatically

### ZK Nationality Membership Proof
1. Run "ZK Service > Nationality Groups" to see available groups
2. Run "ZK Service > Nationality Generate" (with nationalityCode: DEU, groupName: EU)
3. Run "ZK Service > Nationality Verify" - uses stored proof automatically

### Multi-Challenge Liveness
1. Run "Liveness Service > Health Check" to confirm models are loaded
2. Run "Liveness Service > Create Challenge Session" - get random challenges
3. For each challenge, capture image and call appropriate endpoint
4. Run "Liveness Service > Complete Challenge" after each

## Variables

The collection uses post-response scripts to store data between requests:

| Variable | Set By | Used By |
|----------|--------|---------|
| `encrypted_birth_year` | Encrypt Birth Year | Verify Age |
| `zk_proof` | Generate Proof | Verify Proof |
| `zk_public_signals` | Generate Proof | Verify Proof |
| `nationality_proof` | Nationality Generate | Nationality Verify |
| `nationality_signals` | Nationality Generate | Nationality Verify |
| `challenge_session_id` | Create Challenge Session | Complete Challenge |
| `current_challenge_type` | Create Challenge Session | Complete Challenge |

## Environment Variables

Both environments (Local and Docker) use the same URLs since Docker maps ports to localhost:

- `fhe_base_url`: http://localhost:5001
- `zk_base_url`: http://localhost:5002
- `liveness_base_url`: http://localhost:5003
- `ocr_base_url`: http://localhost:5004

## Performance Expectations

| Operation | Expected Time |
|-----------|---------------|
| FHE Encryption | <1ms |
| FHE Age Check | 80-130ms |
| ZK Age Proof Generation | 100-500ms |
| ZK Age Proof Verification | 10-50ms |
| ZK Nationality Proof Generation | 200-700ms |
| ZK Nationality Proof Verification | <50ms |
| Head Pose Detection | 30-50ms |
| Challenge Session Create | <10ms |

## Troubleshooting

### FHE Service shows "unhealthy"
- Wait 60 seconds after starting - key generation takes time
- Check logs: `docker compose logs fhe-service`

### Liveness Service shows "unhealthy"
- First startup downloads ML models (~500MB) - may take 30-60s
- Models are cached in Docker volumes for subsequent starts
- Check logs: `docker compose logs liveness-service`

### "Connection refused" errors
- Ensure services are running: `docker compose ps`
- Check if ports are available: `lsof -i :5001 -i :5002 -i :5003 -i :5004`

### Verify Age returns error
- Ensure you ran "Encrypt Birth Year" first
- The ciphertext variable may have expired - re-run encryption

### Nationality proof returns "circuit not compiled"
- The nationality circuit artifacts should be included in the container
- If not, run `pnpm run circuit:build:nationality` in apps/zk

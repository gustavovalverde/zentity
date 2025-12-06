# Zentity Crypto Services - Bruno Collection

API collection for testing the Zentity FHE and ZK proof services.

## Prerequisites

1. Install [Bruno](https://www.usebruno.com/) (open-source API client)
2. Have Docker installed and running

## Quick Start

```bash
# Start the crypto services
cd services
docker compose up -d fhe-service zk-service

# Wait ~60 seconds for FHE key generation (first time only)
# Then check status:
docker compose ps
```

## Opening the Collection

1. Open Bruno
2. Click "Open Collection"
3. Navigate to `services/bruno-collection`
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
| `/verify-proof` | POST | Verify a proof |

## Typical Workflows

### FHE Age Verification
1. Run "FHE Service > Health Check" to confirm service is up
2. Run "FHE Service > Encrypt Birth Year" (with birthYear: 1990)
3. Run "FHE Service > Verify Age" - uses stored ciphertext automatically

### ZK Age Proof
1. Run "ZK Service > Health Check" to confirm service is up
2. Run "ZK Service > Generate Proof" (with birthYear: 1990)
3. Run "ZK Service > Verify Proof" - uses stored proof automatically

## Variables

The collection uses post-response scripts to store data between requests:

| Variable | Set By | Used By |
|----------|--------|---------|
| `encrypted_birth_year` | Encrypt Birth Year | Verify Age |
| `zk_proof` | Generate Proof | Verify Proof |
| `zk_public_signals` | Generate Proof | Verify Proof |

## Environment Variables

Both environments (Local and Docker) use the same URLs since Docker maps ports to localhost:

- `fhe_base_url`: http://localhost:5001
- `zk_base_url`: http://localhost:5002

## Performance Expectations

| Operation | Expected Time |
|-----------|---------------|
| FHE Encryption | <1ms |
| FHE Age Check | 80-130ms |
| ZK Proof Generation | 100-500ms |
| ZK Proof Verification | 10-50ms |

## Troubleshooting

### FHE Service shows "unhealthy"
- Wait 60 seconds after starting - key generation takes time
- Check logs: `docker compose logs fhe-service`

### "Connection refused" errors
- Ensure services are running: `docker compose ps`
- Check if ports are available: `lsof -i :5001` and `lsof -i :5002`

### Verify Age returns error
- Ensure you ran "Encrypt Birth Year" first
- The ciphertext variable may have expired - re-run encryption

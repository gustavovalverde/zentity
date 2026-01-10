# FROST Signer Service - Railway Deployment Guide

This document describes how to deploy and manage the FROST threshold signature services on Railway.

## Architecture Overview

The FROST signer system provides threshold signatures for decentralized attestation authority. It consists of:

| Service | Role | Port | Purpose |
|---------|------|------|---------|
| `signer-coordinator` | Coordinator | 5002 | Orchestrates DKG and signing sessions |
| `signer-1` | Signer | 5101 | Holds key share #1 |
| `signer-2` | Signer | 5101 | Holds key share #2 |
| `signer-3` | Signer | 5101 | Holds key share #3 |

```
┌─────────────┐     ┌──────────────────────┐     ┌───────────────┐
│   Web App   │────▶│  Signer Coordinator  │────▶│   Signer 1    │
│  (port 3000)│     │    (port 5002)       │     │  (port 5101)  │
└─────────────┘     └──────────────────────┘     └───────────────┘
                              │                          │
                              ├─────────────────▶┌───────────────┐
                              │                  │   Signer 2    │
                              │                  │  (port 5101)  │
                              │                  └───────────────┘
                              │                          │
                              └─────────────────▶┌───────────────┐
                                                 │   Signer 3    │
                                                 │  (port 5101)  │
                                                 └───────────────┘
```

All services communicate over Railway's private internal network (`*.railway.internal`).

## Prerequisites

- Railway CLI installed and authenticated
- Project linked: `railway link`
- Services created in Railway project

## Service Configuration

### Signer Services (signer-1, signer-2, signer-3)

Each signer instance uses `Dockerfile.signer` and requires these environment variables:

```env
SIGNER_ROLE=signer
SIGNER_ID=signer-N              # signer-1, signer-2, or signer-3
SIGNER_PORT=5101
SIGNER_HOST=::
SIGNER_DB_PATH=/var/lib/zentity/signer/signer.redb
SIGNER_CIPHERSUITE=secp256k1
SIGNER_KEK_PROVIDER=local
INTERNAL_SERVICE_TOKEN=<shared-secret>
RUST_LOG=signer_service=info,actix_web=info
RAILWAY_DOCKERFILE_PATH=Dockerfile.signer
```

### Coordinator Service (signer-coordinator)

The coordinator uses `Dockerfile.coordinator` and requires these environment variables:

```env
SIGNER_ROLE=coordinator
SIGNER_PORT=5002
SIGNER_HOST=::
SIGNER_DB_PATH=/var/lib/zentity/signer/coordinator.redb
SIGNER_ENDPOINTS=http://signer-1.railway.internal:5101,http://signer-2.railway.internal:5101,http://signer-3.railway.internal:5101
INTERNAL_SERVICE_TOKEN=<shared-secret>
RUST_LOG=signer_service=info,actix_web=info
RAILWAY_DOCKERFILE_PATH=Dockerfile.coordinator
```

Optional coordinator variables:
```env
GUARDIAN_ASSERTION_JWKS_URL=<jwks-url>  # For JWT verification in Phase 3
```

### Web Service Connection

The web service needs these variables to connect to the signer system:

```env
SIGNER_COORDINATOR_URL=http://signer-coordinator.railway.internal:5002
SIGNER_ENDPOINTS=http://signer-1.railway.internal:5101,http://signer-2.railway.internal:5101,http://signer-3.railway.internal:5101
```

## Volume Requirements

Each service requires a persistent volume for the ReDB database:

| Service | Volume Mount Path | Purpose |
|---------|------------------|---------|
| signer-coordinator | `/var/lib/zentity/signer` | DKG sessions, signing state |
| signer-1 | `/var/lib/zentity/signer` | Encrypted key share |
| signer-2 | `/var/lib/zentity/signer` | Encrypted key share |
| signer-3 | `/var/lib/zentity/signer` | Encrypted key share |

Create volumes via Railway dashboard:
1. Go to service settings
2. Click "Add Volume"
3. Set mount path to `/var/lib/zentity/signer`

## Deployment Commands

### Deploy Signers (deploy these first)

```bash
# Signers must be healthy before coordinator can start
railway up apps/signer --path-as-root --service signer-1
railway up apps/signer --path-as-root --service signer-2
railway up apps/signer --path-as-root --service signer-3
```

### Deploy Coordinator

```bash
# Only after signers are healthy
railway up apps/signer --path-as-root --service signer-coordinator
```

### Set Environment Variables

```bash
# Example for signer-1
railway variables --service signer-1 \
  --set "SIGNER_ROLE=signer" \
  --set "SIGNER_ID=signer-1" \
  --set "SIGNER_PORT=5101" \
  --set "SIGNER_HOST=::" \
  --set "SIGNER_DB_PATH=/var/lib/zentity/signer/signer.redb" \
  --set "SIGNER_CIPHERSUITE=secp256k1" \
  --set "SIGNER_KEK_PROVIDER=local" \
  --set "INTERNAL_SERVICE_TOKEN=<token>" \
  --set "RUST_LOG=signer_service=info,actix_web=info" \
  --set "RAILWAY_DOCKERFILE_PATH=Dockerfile.signer"
```

## Health Checks

All services expose `/health` endpoint:

```bash
# From within Railway network
curl http://signer-coordinator.railway.internal:5002/health
curl http://signer-1.railway.internal:5101/health
curl http://signer-2.railway.internal:5101/health
curl http://signer-3.railway.internal:5101/health
```

## Security Considerations

1. **Internal Only**: All signer services use Railway's private network. They should NOT have public domains.

2. **Shared Token**: The `INTERNAL_SERVICE_TOKEN` must be identical across:
   - Web service
   - Signer coordinator
   - All signer instances

3. **Key Isolation**: Each signer holds exactly one encrypted key share. The coordinator never sees plaintext shares.

4. **mTLS (Future)**: Production deployments should enable mTLS between coordinator and signers using:
   - `SIGNER_MTLS_CA_PATH`
   - `SIGNER_MTLS_CERT_PATH`
   - `SIGNER_MTLS_KEY_PATH`

## Troubleshooting

### Build Failures

**Cache mount ID error**: Ensure cache mount IDs in Dockerfiles don't contain `/` characters.

**Rust compilation timeout**: Railway Pro plan recommended for longer build times. Rust builds can take 5-10 minutes.

### Runtime Issues

**Coordinator can't reach signers**: Check that:
- All signers are healthy first
- `SIGNER_ENDPOINTS` uses correct Railway internal DNS names
- Network connectivity exists between services

**ReDB permission errors**: The container starts as root to fix volume permissions, then drops to non-root user. Ensure the start script (`start.sh`) is executable.

### Checking Logs

```bash
# Build logs
railway logs --service signer-1 --build

# Deploy logs
railway logs --service signer-1
```

## Adding/Removing Signers

The FROST threshold scheme is configured as 2-of-3 by default. To change the number of signers:

1. Update `SIGNER_ENDPOINTS` in coordinator to include all signer URLs
2. Deploy additional signer services with unique `SIGNER_ID` values
3. Run DKG (Distributed Key Generation) to generate new key shares
4. Update web service `SIGNER_ENDPOINTS` if needed

**Warning**: Changing the signer set requires a new DKG ceremony. Existing key shares become invalid.

## Related Documentation

- [FROST Threshold Registrar RFC](rfcs/0015-frost-threshold-registrar.md)
- [Guardian Recovery RFC](rfcs/0014-frost-social-recovery.md)
- [Architecture Overview](architecture.md)

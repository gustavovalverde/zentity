# FROST Signer Service

Threshold signature service implementing [FROST (Flexible Round-Optimized Schnorr Threshold Signatures)](https://eprint.iacr.org/2020/852.pdf) for guardian-based key recovery.

## Architecture

The service uses a **message-bus architecture** where:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                              Web App                                     │
│                                                                          │
│  Initiates all operations:                                               │
│  • Calls signers directly for round package generation                   │
│  • Submits collected packages to coordinator for validation/storage      │
│  • Triggers finalization/aggregation after all packages collected        │
└──────────┬───────────────────────────────────────────┬───────────────────┘
           │                                           │
           │ Direct calls for                          │ Submit packages for
           │ round generation                          │ validation & storage
           ▼                                           ▼
┌───────────────────────┐               ┌──────────────────────────────────┐
│      Signer 1         │               │          Coordinator             │
│  ┌─────────────────┐  │               │                                  │
│  │   Key Share 1   │  │               │  • Validates packages            │
│  └─────────────────┘  │               │  • Stores session state          │
│  • DKG participation  │               │  • Routes messages between       │
│  • Partial signatures │               │    participants                  │
└───────────────────────┘               │  • Aggregates final signatures   │
                                        │  • Never sees plaintext shares   │
┌───────────────────────┐               │                                  │
│      Signer 2         │               └──────────────────────────────────┘
│  ┌─────────────────┐  │
│  │   Key Share 2   │  │
│  └─────────────────┘  │
└───────────────────────┘

┌───────────────────────┐
│      Signer 3         │
│  ┌─────────────────┐  │
│  │   Key Share 3   │  │
│  └─────────────────┘  │
└───────────────────────┘
```

**Key design principles:**

1. **Coordinator as message bus** - The coordinator collects and routes packages but doesn't directly orchestrate signers. It validates packages, manages session state, and performs aggregation.

2. **Web app drives the flow** - The client application (web app) initiates all operations by calling signers directly for round generation, then submitting results to the coordinator.

3. **Signer isolation** - Each signer holds exactly one key share and never sees other signers' shares. Key shares are encrypted at rest using envelope encryption.

## Roles

The same binary runs as either **coordinator** or **signer** based on `SIGNER_ROLE`:

| Role | Purpose | Default Port |
|------|---------|--------------|
| `coordinator` | Orchestrates DKG/signing, validates packages, aggregates signatures | 5002 |
| `signer` | Holds one key share, produces partial signatures | 5101 |

## Protocol Flows

### Distributed Key Generation (DKG)

```text
Web App                     Signers                      Coordinator
   │                           │                              │
   │──── POST /signer/dkg/round1 ──────▶│                     │
   │◀──── Round 1 packages ─────────────│                     │
   │                                                          │
   │──── POST /dkg/init ──────────────────────────────────────▶│
   │◀──── Session created ────────────────────────────────────│
   │                                                          │
   │──── POST /dkg/round1 (submit all packages) ──────────────▶│
   │◀──── Packages validated ─────────────────────────────────│
   │                                                          │
   │──── POST /signer/dkg/round2 ──────▶│                     │
   │◀──── Round 2 packages ─────────────│                     │
   │                                                          │
   │──── POST /dkg/round2 (submit all packages) ──────────────▶│
   │                                                          │
   │──── POST /dkg/finalize ──────────────────────────────────▶│
   │◀──── Group public key ───────────────────────────────────│
```

### Threshold Signing

```text
Web App                     Signers                       Coordinator
   │                           │                               │
   │──── POST /signing/init ──────────────────────────────────▶│
   │◀──── Session created ─────────────────────────────────────│
   │                                                           │
   │──── POST /signer/sign/commit ─────▶│                      │
   │◀──── Commitments ──────────────────│                      │
   │                                                           │
   │──── POST /signing/commit (submit all) ───────────────────▶│
   │                                                           │
   │──── POST /signer/sign/partial ────▶│                      │
   │◀──── Partial signatures ───────────│                      │
   │                                                           │
   │──── POST /signing/partial (submit all) ──────────────────▶│
   │                                                           │
   │──── POST /signing/aggregate ─────────────────────────────▶│
   │◀──── Final signature ─────────────────────────────────────│
```

## API Endpoints

### Coordinator Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/dkg/init` | POST | Initialize DKG session |
| `/dkg/round1` | POST | Submit round 1 package |
| `/dkg/round2` | POST | Submit round 2 package |
| `/dkg/finalize` | POST | Finalize DKG, generate group key |
| `/dkg/{session_id}` | GET | Get DKG session status |
| `/signing/init` | POST | Initialize signing session |
| `/signing/commit` | POST | Submit signing commitment |
| `/signing/partial` | POST | Submit partial signature |
| `/signing/aggregate` | POST | Aggregate into final signature |
| `/signing/{session_id}` | GET | Get signing session status |

### Signer Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/signer/info` | GET | Get signer info (participant ID, HPKE pubkey) |
| `/signer/keys` | GET | List key shares held by this signer |
| `/signer/dkg/round1` | POST | Generate DKG round 1 package |
| `/signer/dkg/round2` | POST | Generate DKG round 2 packages |
| `/signer/dkg/finalize` | POST | Finalize DKG, store key share |
| `/signer/sign/commit` | POST | Generate signing commitment |
| `/signer/sign/partial` | POST | Generate partial signature |

## Configuration

### Environment Variables

#### Common (both roles)

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNER_ROLE` | `coordinator` or `signer` | **required** |
| `SIGNER_PORT` | HTTP port | 5002 (coordinator), 5101 (signer) |
| `SIGNER_HOST` | Bind address | `::` (dual-stack IPv4/IPv6) |
| `SIGNER_DB_PATH` | ReDB database path | `./.data/{role}.redb` |
| `INTERNAL_SERVICE_TOKEN` | Shared secret for web app auth | (none) |
| `RUST_LOG` | Log level filter | `info` |

#### Coordinator-specific

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNER_ENDPOINTS` | Comma-separated signer URLs | **required** |
| `SIGNER_MTLS_CA_PATH` | CA certificate for verifying signers | (none) |
| `SIGNER_MTLS_CERT_PATH` | Coordinator's client certificate | (none) |
| `SIGNER_MTLS_KEY_PATH` | Coordinator's private key | (none) |
| `GUARDIAN_ASSERTION_JWKS_URL` | JWKS endpoint for JWT verification | (none) |

#### Signer-specific

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNER_ID` | Unique identifier (e.g., `signer-1`) | **required** |
| `SIGNER_CIPHERSUITE` | `secp256k1` or `ed25519` | `secp256k1` |
| `SIGNER_KEK_PROVIDER` | `local` or `kms` | `local` |
| `SIGNER_KEK_ID` | KMS key ID (if using KMS) | (none) |

## Development

### Build

```bash
cargo build --release
```

### Run Locally

```bash
# Terminal 1: Coordinator
SIGNER_ROLE=coordinator \
SIGNER_ENDPOINTS=http://localhost:5101,http://localhost:5102,http://localhost:5103 \
cargo run --release --bin coordinator

# Terminal 2-4: Signers
SIGNER_ROLE=signer SIGNER_ID=signer-1 SIGNER_PORT=5101 cargo run --release --bin signer
SIGNER_ROLE=signer SIGNER_ID=signer-2 SIGNER_PORT=5102 cargo run --release --bin signer
SIGNER_ROLE=signer SIGNER_ID=signer-3 SIGNER_PORT=5103 cargo run --release --bin signer
```

### Docker Compose

```bash
# Build and run coordinator + 3 signers
docker-compose -f docker-compose.signer.yml build
docker-compose -f docker-compose.signer.yml up
```

Services:

- Coordinator: `http://localhost:5002`
- Signer 1: `http://localhost:5101`
- Signer 2: `http://localhost:5102`
- Signer 3: `http://localhost:5103`

### Testing

```bash
# Unit tests
cargo test

# Integration tests (requires all services running)
cargo test --test frost_integration

# Clippy
cargo clippy
```

## Security

### Key Protection

- **Envelope encryption**: Key shares encrypted with AES-256-GCM, KEK from local file or AWS KMS
- **HPKE**: Round 2 packages encrypted point-to-point between signers
- **Memory isolation**: Key shares only decrypted in memory during operations

### Network Security

- **mTLS** (optional): Mutual TLS between coordinator and signers
- **JWT verification** (optional): Guardian assertions validated via JWKS
- **Service token**: Shared secret for web app authentication

### Ciphersuites

| Ciphersuite | Curve | Use Case |
|-------------|-------|----------|
| `secp256k1` | secp256k1 | Bitcoin, Ethereum compatible |
| `ed25519` | Curve25519 | General purpose, faster |

## Related Documentation

- [RFC-0014: FROST Social Recovery](../../../docs/rfcs/0014-frost-social-recovery.md) - Full protocol specification
- [FROST Implementation Plan](../../../docs/internal/frost-implementation-plan.md) - Implementation phases

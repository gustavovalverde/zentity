# BBS+ Credentials Module

Internal BBS+ credential implementation for wallet identity verification
with selective disclosure.

## Overview

This module provides BBS+ signature-based verifiable credentials for wallet
identity. Users can:

1. **Receive credentials** after identity verification linking their wallet
2. **Create presentations** revealing only selected claims (selective disclosure)
3. **Prove ownership** without revealing sensitive data like wallet addresses

## Cryptographic Primitives

| Property    | Value                          |
| ----------- | ------------------------------ |
| Library     | `@mattrglobal/pairing-crypto`  |
| Curve       | BLS12-381                      |
| Ciphersuite | `bls12381_shake256`            |
| Secret key  | 32 bytes (BLS12-381 scalar)    |
| Public key  | 96 bytes (BLS12-381 G2 point)  |
| Signature   | 80 bytes                       |

## Module Structure

```text
src/lib/bbs/
├── serialization.ts  # Shared serialization for server/client
├── types.ts          # Type definitions (BbsCredential, BbsPresentation, etc.)
├── keygen.ts         # Key generation and validation
├── signer.ts         # Credential creation and signing (issuer)
├── holder.ts         # Presentation creation (holder)
├── verifier.ts       # Signature and proof verification
├── client-storage.ts # IndexedDB storage for credentials
├── hooks.ts          # React hooks for credential management
└── __tests__/
    ├── bbs.test.ts                    # Unit tests
    ├── bbs-security.test.ts           # Security tests
    └── bbs-lifecycle.integration.test.ts  # Integration tests
```

## Usage

### Issuer: Create Credential

```typescript
import { generateBbsKeyPair } from "@/lib/bbs/keygen";
import { createWalletCredential } from "@/lib/bbs/signer";

const issuerKeyPair = await generateBbsKeyPair();

const subject = {
  walletCommitment: "0xhash_of_wallet_address_and_salt",
  network: "ethereum",
  chainId: 1,
  verifiedAt: new Date().toISOString(),
  tier: 2,
};

const credential = await createWalletCredential(
  subject,
  issuerKeyPair,
  "did:web:zentity.xyz",
  "did:key:holder123"
);
```

### Holder: Create Presentation

```typescript
import { createPresentation } from "@/lib/bbs/holder";

// Reveal only network and tier (hide wallet commitment)
const presentation = await createPresentation(
  credential,
  ["network", "tier"],
  "verifier-challenge-nonce"
);
```

### Verifier: Verify Presentation

```typescript
import { verifyPresentation } from "@/lib/bbs/verifier";

const result = await verifyPresentation(presentation);
if (result.verified) {
  console.log("Revealed claims:", presentation.revealedClaims);
}
```

## Credential Format

### Credential (bbs+vc)

```typescript
interface BbsCredential {
  format: "bbs+vc";
  issuer: string;        // did:web:zentity.xyz
  holder: string;        // did:key:...
  issuedAt: string;      // ISO 8601
  subject: {
    walletCommitment: string;
    network: string;
    chainId?: number;
    verifiedAt: string;
    tier: number;
  };
  signature: BbsSignature;
  issuerPublicKey: Uint8Array;
}
```

### Presentation (bbs+vp)

```typescript
interface BbsPresentation {
  format: "bbs+vp";
  issuer: string;
  proof: BbsProof;
  revealedClaims: Partial<WalletIdentitySubject>;
  issuerPublicKey: Uint8Array;
  header?: Uint8Array;
}
```

## Security Properties

### Unforgeability

Signatures and proofs cannot be tampered with. Any modification to claims or
proof bytes causes verification failure.

### Selective Disclosure

Hidden claims are cryptographically protected. Verifiers learn nothing about
unrevealed claims beyond that they exist and were signed by the issuer.

### Unlinkability

Different presentations from the same credential are unlinkable. Each
presentation uses a verifier-specific nonce, producing unique proof bytes
that cannot be correlated across verifiers.

## Identity Circuit Integration

BBS+ presentations integrate with the identity binding circuit
(`noir-circuits/identity_binding/`) for replay-protected wallet auth.

### How It Works

1. **Credential Issuance**: During wallet auth, a credential is issued with:
   - `walletCommitment`: Hash of wallet address + salt (privacy-preserving)
   - `network`: Blockchain network identifier
   - `tier`: User's verification tier

2. **Presentation Creation**: Holder creates a selective disclosure presentation:
   - Revealed: `tier` (verification level), `network` (wallet origin)
   - Hidden: `walletCommitment` (privacy-preserved)

3. **Circuit Integration**: The identity binding circuit accepts:
   - The BBS+ presentation proof bytes
   - A binding secret derived from wallet signature
   - A nonce for replay protection

```typescript
// Example: Creating presentation for identity circuit
const presentation = await createPresentation(
  credential,
  ["network", "tier"],  // Revealed claims
  circuitNonce          // Binds proof to specific session
);

// The presentation.proof.proof bytes are used as circuit input
const circuitInputs = {
  bbsProof: presentation.proof.proof,
  bindingSecret: deriveBindingSecret(walletSignature),
  nonce: circuitNonce,
};
```

### Circuit Security Guarantees

- **Replay Protection**: Each presentation is bound to a unique nonce
- **Unlinkability**: Different presentations cannot be correlated
- **Selective Disclosure**: Wallet address commitment stays hidden

## tRPC API

The module exposes a tRPC router at `crypto.bbs.*`:

| Procedure            | Auth      | Description                              |
| -------------------- | --------- | ---------------------------------------- |
| `issueCredential`    | Protected | Issue credential for wallet              |
| `createPresentation` | Protected | Derive selective disclosure presentation |
| `verifyPresentation` | Public    | Verify a presentation                    |
| `getIssuerPublicKey` | Public    | Get issuer's BBS+ public key             |

## W3C VC-DI-BBS Spec Deviations

This implementation uses a simplified internal format, **not** the W3C
VC-DI-BBS standard.

| Feature          | W3C VC-DI-BBS        | This Implementation     |
| ---------------- | -------------------- | ----------------------- |
| Proof type       | `DataIntegrityProof` | `bbs+vc` / `bbs+vp`     |
| Cryptosuite      | `bbs-2023`           | `bls12381_shake256` ✓   |
| Encoding         | CBOR + multibase `u` | JSON + base64           |
| Key format       | Multicodec `0xeb01`  | Raw Uint8Array          |
| Canonicalization | JSON-LD + RDF        | Ordered array           |

### Why Deviate?

1. **Simpler serialization** - JSON/base64 instead of CBOR/multibase
2. **No JSON-LD dependency** - Avoids complex RDF processing
3. **Internal use only** - No external interoperability needed yet
4. **Same cryptographic security** - Identical BLS12-381 primitives

### Future: W3C Compliance

For external interoperability, a separate `src/lib/bbs-2023/` module could
implement:

- JSON-LD processing (`jsonld` package)
- CBOR encoding (`cbor-x` package)
- RDF canonicalization (RDFC-1.0)
- `DataIntegrityProof` format
- Multicodec key encoding

## Configuration

### Environment Setup

Generate a 32-byte issuer secret:

```bash
openssl rand -hex 32
```

Add to your `.env`:

```bash
# BBS+ issuer secret - enables credential issuance and verification
BBS_ISSUER_SECRET=<your-64-character-hex-string>
```

### Environment Variables

| Variable            | Description                                        |
| ------------------- | -------------------------------------------------- |
| `BBS_ISSUER_SECRET` | 64-char hex string (32 bytes) for issuer key       |

### Feature Detection

BBS+ features are automatically enabled when `BBS_ISSUER_SECRET` is set:

- **OIDC4VCI metadata** includes `bbs+vc` credential configuration
- **tRPC router** enables all BBS+ operations
- **E2E tests** run credential issuance and verification

Without the secret, the system gracefully degrades: BBS+ endpoints return
errors, and E2E tests skip.

### Docker Compose

The `docker-compose.yml` includes `BBS_ISSUER_SECRET` in the frontend
service. Set it in your environment or `.env` file at the repo root:

```bash
BBS_ISSUER_SECRET=<your-64-character-hex-string>
```

## Testing

```bash
# Unit tests
pnpm test:unit src/lib/bbs/__tests__/bbs.test.ts

# Security tests
pnpm test:unit src/lib/bbs/__tests__/bbs-security.test.ts

# Integration tests
pnpm test:integration src/lib/bbs/__tests__/bbs-lifecycle.integration.test.ts

# tRPC router tests
pnpm test:unit src/lib/trpc/routers/__tests__/bbs.test.ts

# Presentation verification API tests
pnpm test:integration src/app/api/verify/__tests__/presentation.integration.test.ts

# E2E tests (requires BBS_ISSUER_SECRET configured)
pnpm test:e2e --project=bbs
```

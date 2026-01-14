# Demo Wallet

A simplified digital wallet for demonstrating OIDC4VCI/VP credential flows. This wallet acts as the **holder** in the verifiable credentials ecosystem, storing credentials and controlling what gets disclosed.

## Your Agent for Controlling Disclosure

Traditional identity sharing is all-or-nothing: you hand over your passport, and the recipient sees everything. The wallet changes this dynamic.

**The wallet is your agent** that:

- Receives credentials on your behalf
- Stores them locally (you control the data)
- Decides what to reveal for each request
- Proves ownership via holder binding

## Quick Start

```bash
# From this directory
pnpm dev

# Or as part of the demo stack
cd ../demo-hub && pnpm dev:stack
```text

Open <http://localhost:3101> to see the wallet.

## How It Works

### 1. Receive Credential (OIDC4VCI)

When an issuer creates a credential offer, the wallet:

1. Receives the pre-authorized code from the offer
2. Exchanges it for an access token at the issuer's token endpoint
3. Generates a holder key pair (EdDSA)
4. Creates a proof JWT binding the credential to the holder key
5. Requests the credential with holder binding proof
6. Stores the SD-JWT credential locally

```text
Issuer                    Wallet
   │                         │
   │ ──── Offer (code) ────> │
   │                         │
   │ <── Token request ───── │
   │ ──── Access token ────> │
   │                         │
   │ <─── Credential req ─── │
   │      (with proof JWT)   │
   │                         │
   │ ──── SD-JWT VC ───────> │
   │                         │
```text

### 2. Store Credential

The wallet stores:

- The SD-JWT credential (with selective disclosure markers)
- The holder private key (for proving ownership)
- The holder public key (embedded in the credential)
- Issuer information

**Storage**: In this demo, localStorage is used for simplicity. A production wallet would use secure enclave storage.

### 3. Select Claims for Disclosure

When a verifier requests specific claims, you choose what to reveal:

```text
CREDENTIAL CLAIMS              REQUEST ASKS FOR           YOU REVEAL
─────────────────              ────────────────           ──────────
✓ verification_level           verification_level    →   verification_level
✓ verified                     verified              →   verified
✓ document_verified            age_proof_verified    →   age_proof_verified
✓ liveness_verified
✓ age_proof_verified
✓ nationality_proof
✓ face_match_verified
```text

Checkboxes let you add or remove claims from disclosure.

### 4. Present Credential (OIDC4VP)

When you submit a presentation:

1. The wallet filters the SD-JWT to include only selected claims
2. Creates a VP Token with the filtered credential
3. Sends to the verifier's presentation endpoint
4. Verifier validates signature, issuer, and claims

```text
Wallet                    Verifier
   │                         │
   │ ─── VP Token ─────────> │
   │     (filtered claims)   │
   │                         │
   │ <── Verification ────── │
   │     result              │
   │                         │
```text

## Features

### Selective Disclosure

Each claim can be independently disclosed or withheld. The SD-JWT format uses cryptographic hashes so verifiers can't infer hidden claims.

### Holder Binding

The wallet generates a key pair at credential issuance. The public key is embedded in the credential. This proves:

- You received the credential directly from the issuer
- You control the private key
- The credential hasn't been transferred to someone else

### Local Storage

Credentials stay on your device. No cloud sync, no central database. You decide when and to whom to present.

## Technical Details

### Credential Format

SD-JWT VC (Selective Disclosure JWT Verifiable Credential):

```text
<JWT>~<disclosure1>~<disclosure2>~<disclosure3>...
```text

Each `~<disclosure>` is a base64url-encoded claim that can be revealed or hidden independently.

### Key Generation

- Algorithm: EdDSA (Ed25519)
- Generated fresh for each credential
- Extractable keys for storage (demo only; production would use non-extractable keys)

### Disclosure Frame

When presenting, a "frame" specifies which claims to reveal:

```typescript
const frame = {
  verification_level: true,
  verified: true,
  age_proof_verified: true,
  // Other claims omitted → not disclosed
};
```text

## Wallet vs Real-World Wallets

This demo wallet is intentionally simplified:

| Demo Wallet | Production Wallet |
|-------------|-------------------|
| localStorage | Secure enclave / TEE |
| Single credential | Multiple credentials |
| Manual presentation | Automated matching |
| No backup | Backup & recovery |
| Browser only | Native mobile app |

The core concepts (SD-JWT, holder binding, selective disclosure) work the same in production wallets.

## API Integration

### Receiving Offers

The wallet accepts offers via URL parameter:

```text
http://localhost:3101/?offerId=<uuid>
```text

It fetches the full offer from the Demo Hub API.

### Handling Requests

Presentation requests arrive via URL parameter:

```text
http://localhost:3101/?requestId=<uuid>
```text

The wallet fetches the request details (required claims, purpose, nonce) and pre-selects matching claims.

## Common Actions

### Clear Wallet

Click "Clear wallet" to remove the stored credential. This simulates credential revocation or device wipe.

### Toggle Claims

Check/uncheck claims to customize disclosure. Required claims for the current request are pre-selected.

### Issue New Credential

When a new offer arrives, you can issue a fresh credential (replaces the existing one).

## Why This Matters

### Control

You decide what to share, every time. No more "accept all" to proceed.

### Privacy

Verifiers see only what they need. Your birthdate stays hidden when proving "over 18".

### Portability

One credential works with any verifier. No re-verification needed.

### Security

Holder binding prevents credential theft. Even if someone copies your SD-JWT, they can't prove ownership.

## Related Documentation

- [Demo Hub README](../demo-hub/README.md) - Full demo ecosystem documentation
- [OIDC4VCI Spec](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html)
- [SD-JWT Spec](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-selective-disclosure-jwt)

## License

See repository root for license information.

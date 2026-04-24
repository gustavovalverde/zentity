# Zentity Demo RP

A demonstration Relying Party (RP) application that showcases Zentity's privacy-preserving identity verification via OAuth 2.1 with **progressive step-up authorization**.

## What This Demonstrates

This demo shows how Relying Parties consume the [Zentity OIDC Disclosure Profile](../../docs/(protocols)/disclosure-profile.md) via progressive step-up authorization:

1. **DCR**: All scenarios self-register via RFC 7591 Dynamic Client Registration
2. **Sign-in**: Standard + proof scopes only — no vault unlock needed
3. **Step-up**: Business action triggers incremental authorization for `identity.*` scopes — requires vault unlock + exact disclosure binding

The three scope families follow the disclosure profile contract:

- **Standard** (`openid`, `email`) — account claims, no vault
- **Proof** (`proof:*`) — non-PII verification status, generally id_token + userinfo (`proof:sybil` is access-token-only)
- **Identity** (`identity.*`) — vault-gated PII, userinfo only, single-consume

No admin pre-approval is required — the user controls data access at the consent page.

## Seven Scenarios

| Scenario | Sign-In Scopes | Step-Up Scopes | Step-Up Action |
|----------|---------------|----------------|----------------|
| **Velocity Bank** | `openid email proof:verification` | `identity.name` | Open Account |
| **Nova Exchange** | `openid email proof:verification` | `identity.nationality` | Start Trading |
| **Vino Delivery** | `openid email proof:age` | `identity.name identity.address` | Complete Purchase |
| **Relief Global** | `openid email proof:verification` | `identity.name identity.nationality` | Claim Aid |
| **VeriPass** | Digital credential wallet with OID4VP verifier | eIDAS 2.0, NIST 800-63-4 | SD-JWT VC, DCQL, OID4VP, OID4VCI |
| **Aether AI** | `/aether` | CIBA agent authorization | Purchase approval via backchannel auth |
| **x402** | `openid email proof:verification` | Proof-of-Human + Base mirror compliance | HTTP 402, `PAYMENT-SIGNATURE`, `isCompliant` |

## Quick Start

### 1. Start Zentity

```bash
cd apps/web && pnpm dev  # port 3000
```

### 2. Generate Dev Certificates (for OID4VP)

```bash
cd apps/demo-rp && pnpm exec tsx scripts/generate-dev-certs.ts
```

This creates x509 certificates in `.data/certs/` for the OID4VP `x509_hash` client_id scheme.

### 3. Initialize Database

```bash
cd apps/demo-rp && pnpm run db:setup  # creates .data/ + runs db:push
```

### 4. Start Demo RP

```bash
cd apps/demo-rp && pnpm dev  # port 3102
```

**Prerequisites:** Node.js 24+, pnpm 10+, `openssl` (for certificate generation)

### 5. Try It Out

Each scenario page shows a DCR registration step, then sign-in, then step-up.

**Bank (progressive flow):**

1. Navigate to <http://localhost:3102/bank>
2. Register with Zentity (DCR) → sign in → basic claims only
3. Click "Open Account" → consent for identity.name
4. See full verified claims vs. what stays private

**Exchange (progressive flow):**

1. Navigate to <http://localhost:3102/exchange>
2. Register → sign in → basic claims
3. Click "Start Trading" → consent for identity.nationality

**Wine (age-gated flow):**

1. Navigate to <http://localhost:3102/wine>
2. Add to cart → age gate dialog → register → sign in with proof:age
3. Checkout → step-up for identity.name + identity.address

**Aid (humanitarian flow):**

1. Navigate to <http://localhost:3102/aid>
2. Register → verify identity → basic claims
3. Complete verification → consent for identity.name + identity.nationality

**VeriPass (credential wallet + OID4VP):**

1. Navigate to <http://localhost:3102/veripass>
2. Register with Zentity (DCR) → sign in
3. Obtain a credential offer from Zentity Dashboard → Credentials → paste the offer URI
4. Select a verifier scenario → choose which claims to disclose → present credential

**Aether AI (CIBA agent):**

1. Navigate to <http://localhost:3102/aether>
2. Sign in with Zentity (DCR auto-registers)
3. Chat to request a purchase — Aether initiates a CIBA backchannel request
4. Approve/deny via push notification or approval page
5. Agent receives `authorization_details` and fulfills the purchase

Aether uses the `useCibaFlow` polling hook, architecturally distinct from the OAuth code flow used by other scenarios.

**x402 (payment + compliance):**

1. Navigate to <http://localhost:3102/x402>
2. Sign in with Zentity and connect a wallet
3. Select a regulated resource and run the flow
4. The RP returns `PAYMENT-REQUIRED`; the wallet signs `PAYMENT-SIGNATURE`
5. Zentity proof data is carried under `PaymentPayload.extensions.zentity`
6. On-chain resources check Base `IdentityRegistryMirror.isCompliant(payer, requiredLevel)`

For the on-chain tier, the demo uses the Base Sepolia deployment manifest from `@zentity/contracts`. Set `BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR` only when you need to point at a different mirror deployment. If no package manifest or override is available, the demo reports `identity_registry_mirror_not_configured` instead of silently falling back to a mock.

### x402 User Journey

The `/x402` page demonstrates three payment-time access patterns. Each pattern starts with the same visible user flow: the user signs in with Zentity, connects a Base Sepolia wallet, selects a resource, and runs the request. The resource server then returns `402 Payment Required`, the wallet signs the x402 payment payload, and the client retries with `PAYMENT-SIGNATURE`.

| Resource | User precondition | Runtime journey | What the RP learns |
|----------|-------------------|-----------------|--------------------|
| Public API | Wallet can sign and pay | Payment-only retry. No Proof-of-Human token is requested. | Payment settlement result only |
| Verified Identity | User has a Zentity verification tier of 2 or higher | The 402 response advertises `extensions.zentity.minComplianceLevel`. The client obtains a short-lived Proof-of-Human token and attaches it under `PaymentPayload.extensions.zentity.pohToken` before retrying. | Verified tier, sybil-resistance status, and payment settlement result |
| Regulated Financial API | User has Tier 3+ and a mirrored wallet attestation on Base Sepolia | The client performs the Proof-of-Human retry, then the resource server verifies that the wallet which signed the payment is compliant through `IdentityRegistryMirror.isCompliant(payer, requiredLevel)`. | Proof result, Base mirror boolean, payer wallet address, and payment settlement result |

The important privacy boundary is that payment-time access does not disclose raw identity data. The resource server receives no document fields, proof hashes, commitments, FHE ciphertext handles, or decrypted attributes. For the on-chain scenario, the public mirror exposes only wallet address, active mirrored attestation state, and numeric compliance level.

Common failure states are visible in the protocol trace:

1. Missing payment header: the server returns `PAYMENT-REQUIRED`.
2. Missing or invalid Proof-of-Human token: the server rejects the retry before settlement.
3. Wallet mismatch: the server rejects on-chain checks when the caller-provided wallet differs from the payment payer.
4. Mirror not configured or unavailable: the server returns a chain configuration or availability error.
5. Insufficient mirrored compliance: the server rejects access before settlement.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3102 | Server port |
| `NEXT_PUBLIC_APP_URL` | <http://localhost:3102> | Public URL |
| `NEXT_PUBLIC_ZENTITY_URL` | <http://localhost:3000> | Zentity URL (client-side) |
| `BETTER_AUTH_SECRET` | demo-rp-secret... | Auth secret |
| `ZENTITY_URL` | <http://localhost:3000> | Zentity server URL |
| `DATABASE_URL` | file:./.data/demo-rp.db | SQLite database URL |
| `OIDC4VCI_WALLET_CLIENT_ID` | zentity-wallet | OID4VCI wallet client ID |
| `VERIFIER_CERT_PATH` | .data/certs/ | Path to x509 dev certificates |
| `VERIFIER_LEAF_PEM` | — | Base64 leaf certificate PEM (production) |
| `VERIFIER_CA_PEM` | — | Base64 CA certificate PEM (production) |
| `VERIFIER_LEAF_KEY_PEM` | — | Base64 leaf private key PEM (production) |
| `ZENTITY_JWKS_URL` | — | Override JWKS endpoint for VP token verification |
| `BASE_SEPOLIA_RPC_URL` | <https://sepolia.base.org> | Base Sepolia RPC for x402 mirror reads |
| `BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR` | Package manifest | Optional deployed `IdentityRegistryMirror` override for x402 on-chain checks |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token (for remote database) |

## Architecture

- **Next.js 16** with App Router
- **better-auth** with `genericOAuth` plugin (`overrideUserInfo: true` for step-up)
- **shadcn/ui** for components
- **SQLite** (via better-sqlite3) for session storage
- **All-DCR**: Every route scenario self-registers via RFC 7591 and persists the `client_id` in the `dcr_client` table keyed by `scenarioId`

### OID4VCI Issuance Flow

The VeriPass wallet can receive credentials from Zentity via the `/api/veripass/issue` endpoint:

1. Pre-authorized code grant — wallet exchanges code for DPoP-bound access token
2. Holder key generation — ephemeral Ed25519 keypair created client-side
3. Proof JWT — signed with holder key, bound to DPoP nonce
4. Credential storage — SD-JWT VC stored in `localStorage` (not DB, not session)

### Limitations

- **In-memory JAR cache**: VP session JAR JWTs are cached in-memory (single-use). This won't work in multi-instance deployments.
- **Same-device session binding**: `/vp/complete` validates the session cookie matches the VP session creator — cross-device flows are not supported.
- **Experimental: Digital Credentials API**: `dc-api.ts` contains an experimental W3C Digital Credentials API integration path (Chrome 128+ behind flag).

## OAuth Flow

```text
Demo RP                              Zentity
  |                                     |
  |── DCR /register ──────────────────→ |
  |← client_id ──────────────────────  |
  |                                     |
  |── Sign in (basic scopes) ────────→ |
  |                                     |── User authenticates
  |                                     |── Shows consent (basic)
  |← Redirect with code ───────────── |
  |── Exchange code ──────────────────→|
  |← Access token + claims ───────────|
  |                                     |
  | [User clicks business action]       |
  |                                     |
  |── Step-up (+ identity scopes) ───→ |
  |                                     |── Shows consent (identity)
  |← Redirect with code ───────────── |
  |── Exchange code ──────────────────→|
  |← Access token + userinfo-backed identity claims ─|
  |                                     |
  Display: basic → stepped-up claims
```

## OID4VP Verifier (VeriPass)

The `/veripass` page implements a digital credential wallet with an OID4VP verifier. Users receive an SD-JWT VC from Zentity via OID4VCI, then selectively disclose verification claims to four verifier scenarios:

| Verifier | Required Claims | Use Case |
|----------|----------------|----------|
| Border Control | `verified`, `verification_level`, `nationality_verified` | Travel eligibility check with nationality attestation |
| Background Check | `verified`, `verification_level`, `document_verified` | Employment-grade identity assurance screening |
| Age-Restricted Venue | `age_verification` | Minimal disclosure age proof |
| Financial Institution | `verified`, `verification_level`, `document_verified`, `liveness_verified`, `nationality_verified` | KYC-grade assurance without raw identity disclosure |

**Presentation flow:**

1. User selects a verifier scenario
2. A DCQL query is built from the scenario's required claims
3. A VP session is created with a JAR JWT signed using x5c chain (`x509_hash` client_id scheme)
4. The wallet selects disclosures matching the query and creates a VP token
5. The verifier receives the `direct_post.jwt` response (JARM with ECDH-ES P-256 encryption)
6. KB-JWT is verified: holder binding via JWK thumbprint against `cnf.jkt`, audience + nonce + freshness (300s)
7. Disclosed claims are extracted and displayed

### KB-JWT Verification

`verifyVpToken()` in `src/lib/verify.ts` performs the full SD-JWT verification chain: issuer signature against Zentity JWKS, disclosure decode, `cnf.jkt` thumbprint match, KB-JWT signature, and audience/nonce/freshness enforcement.

## How Step-Up Works

Step-up follows the disclosure profile's interaction rules:

1. Sign-in uses **standard + proof scopes** — consent only, no vault unlock
2. Step-up calls `signIn.oauth2()` with `identity.*` scopes — triggers vault unlock + exact binding on Zentity's consent page
3. Zentity stages the PII ephemerally (5-minute TTL, single-consume) and delivers it through the userinfo-backed disclosure path
4. `overrideUserInfo: true` ensures the updated claims overwrite the user record
5. Phase detection checks if `stepUpClaimKeys` are present in `session.user.claims`

The disclosure semantics (vault requirement, delivery surface, binding rules) are enforced by Zentity's auth server, not by the RP. The RP just requests the right scopes.

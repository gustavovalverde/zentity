# Zentity Demo RP

A demonstration Relying Party (RP) application that showcases Zentity's privacy-preserving identity verification via OAuth 2.1 with **progressive step-up authorization**.

## What This Demonstrates

This demo shows how Relying Parties can progressively request identity scopes:

1. **DCR**: All scenarios self-register via RFC 7591 Dynamic Client Registration
2. **Sign-in**: Basic OAuth with standard scopes (openid, email, profile, proof:*)
3. **Step-up**: Business action (e.g., "Open Account") triggers incremental authorization for identity scopes

No admin pre-approval is required — the user controls data access at the consent page.

## Five Scenarios

| Scenario | Sign-In Scopes | Step-Up Scopes | Step-Up Action |
|----------|---------------|----------------|----------------|
| **Velocity Bank** | `openid email proof:verification` | `identity.name` | Open Account |
| **Nova Exchange** | `openid email proof:verification` | `identity.nationality` | Start Trading |
| **Vino Delivery** | `openid email proof:age` | `identity.name identity.address` | Complete Purchase |
| **Relief Global** | `openid email proof:verification` | `identity.name identity.nationality` | Claim Aid |
| **VeriPass** | Digital credential wallet with OID4VP verifier | eIDAS 2.0, NIST 800-63-4 | SD-JWT VC, DCQL, OID4VP, OID4VCI |
| **Aether AI** | `/aether` | CIBA agent authorization | Purchase approval via backchannel auth |

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3102 | Server port |
| `NEXT_PUBLIC_APP_URL` | <http://localhost:3102> | Public URL |
| `NEXT_PUBLIC_ZENTITY_URL` | <http://localhost:3000> | Zentity URL (client-side) |
| `BETTER_AUTH_SECRET` | demo-rp-secret... | Auth secret |
| `ZENTITY_URL` | <http://localhost:3000> | Zentity server URL |
| `ZENTITY_BANK_CLIENT_ID` | zentity-demo-bank | Fallback if DCR file absent |
| `ZENTITY_EXCHANGE_CLIENT_ID` | zentity-demo-exchange | Fallback if DCR file absent |
| `ZENTITY_WINE_CLIENT_ID` | zentity-demo-wine | Fallback if DCR file absent |
| `ZENTITY_AID_CLIENT_ID` | zentity-demo-aid | Fallback if DCR file absent |
| `DATABASE_URL` | file:./.data/demo-rp.db | SQLite database URL |
| `OIDC4VCI_WALLET_CLIENT_ID` | zentity-wallet | OID4VCI wallet client ID |
| `VERIFIER_CERT_PATH` | .data/certs/ | Path to x509 dev certificates |
| `VERIFIER_LEAF_PEM` | — | Base64 leaf certificate PEM (production) |
| `VERIFIER_CA_PEM` | — | Base64 CA certificate PEM (production) |
| `VERIFIER_LEAF_KEY_PEM` | — | Base64 leaf private key PEM (production) |
| `ZENTITY_JWKS_URL` | — | Override JWKS endpoint for VP token verification |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token (for remote database) |

## Architecture

- **Next.js 16** with App Router
- **better-auth** with `genericOAuth` plugin (`overrideUserInfo: true` for step-up)
- **shadcn/ui** for components
- **SQLite** (via better-sqlite3) for session storage
- **All-DCR**: Every scenario self-registers via RFC 7591, stored in `.data/dcr-{providerId}.json`

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
  |← Updated claims (+ identity) ────|
  |                                     |
  Display: basic → stepped-up claims
```

## OID4VP Verifier (VeriPass)

The `/veripass` page implements a digital credential wallet with an OID4VP verifier. Users receive an SD-JWT VC from Zentity via OID4VCI, then selectively disclose claims to four verifier scenarios:

| Verifier | Required Claims | Use Case |
|----------|----------------|----------|
| Border Control | `given_name`, `family_name`, `nationality` | International travel identity check |
| Background Check | `given_name`, `family_name`, `verification_level` | Employment verification screening |
| Age-Restricted Venue | `age_over_18` | Minimal disclosure age proof |
| Financial Institution | `given_name`, `family_name`, `nationality`, `verification_level`, `email` | Full KYC |

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

1. Config scopes are **basic only** — sign-in never requests identity data
2. Step-up calls `signIn.oauth2()` again with runtime scopes that include `identity.*`
3. `overrideUserInfo: true` ensures the updated claims overwrite the user record
4. Phase detection checks if `stepUpClaimKeys` are present in `session.user.claims`

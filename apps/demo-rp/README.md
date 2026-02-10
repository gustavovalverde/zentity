# Zentity Demo RP

A demonstration Relying Party (RP) application that showcases Zentity's privacy-preserving identity verification via OAuth 2.1 with **progressive step-up authorization**.

## What This Demonstrates

This demo shows how Relying Parties can progressively request identity scopes:

1. **DCR**: All scenarios self-register via RFC 7591 Dynamic Client Registration
2. **Sign-in**: Basic OAuth with standard scopes (openid, email, profile, proof:*)
3. **Step-up**: Business action (e.g., "Open Account") triggers incremental authorization for identity scopes

No admin pre-approval is required — the user controls data access at the consent page.

## Four Scenarios

| Scenario | Sign-In Scopes | Step-Up Scopes | Step-Up Action |
|----------|---------------|----------------|----------------|
| **Velocity Bank** | `openid profile email proof:verification` | `identity.name identity.address` | Open Account |
| **Nova Exchange** | `openid profile email proof:verification` | `identity.nationality` | Start Trading |
| **Vino Delivery** | `openid email proof:age` | `identity.name identity.address` | Complete Purchase |
| **Relief Global** | `openid email proof:verification` | `identity.name identity.nationality` | Claim Aid |

## Quick Start

### 1. Start Zentity

```bash
cd apps/web && pnpm dev  # port 3000
```

### 2. Start Demo RP

```bash
cd apps/demo-rp && pnpm dev  # port 3102
```

### 3. Try It Out

Each scenario page shows a DCR registration step, then sign-in, then step-up.

**Bank (progressive flow):**

1. Navigate to <http://localhost:3102/bank>
2. Register with Zentity (DCR) → sign in → basic claims only
3. Click "Open Account" → consent for identity.name + identity.address
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3102 | Server port |
| `NEXT_PUBLIC_APP_URL` | <http://localhost:3102> | Public URL |
| `BETTER_AUTH_SECRET` | demo-rp-secret... | Auth secret |
| `ZENTITY_URL` | <http://localhost:3000> | Zentity server URL |
| `ZENTITY_BANK_CLIENT_ID` | zentity-demo-bank | Fallback if DCR file absent |
| `ZENTITY_EXCHANGE_CLIENT_ID` | zentity-demo-exchange | Fallback if DCR file absent |
| `ZENTITY_WINE_CLIENT_ID` | zentity-demo-wine | Fallback if DCR file absent |
| `ZENTITY_AID_CLIENT_ID` | zentity-demo-aid | Fallback if DCR file absent |
| `DATABASE_PATH` | .data/demo-rp.db | Local SQLite path |

## Architecture

- **Next.js 16** with App Router
- **better-auth** with `genericOAuth` plugin (`overrideUserInfo: true` for step-up)
- **shadcn/ui** for components
- **SQLite** (via better-sqlite3) for session storage
- **All-DCR**: Every scenario self-registers via RFC 7591, stored in `.data/dcr-{providerId}.json`

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

## How Step-Up Works

1. Config scopes are **basic only** — sign-in never requests identity data
2. Step-up calls `signIn.oauth2()` again with runtime scopes that include `identity.*`
3. `overrideUserInfo: true` ensures the updated claims overwrite the user record
4. Phase detection checks if `stepUpClaimKeys` are present in `session.user.claims`

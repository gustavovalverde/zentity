# Relying Party Redirect Flow

This document explains the **RP redirect flow** implemented in `apps/web`.

Implementation note: `/api/rp/*` is implemented as a Hono router mounted inside Next.js (App Router route handler).

It is intentionally **OAuth-like** (authorization code + server-to-server exchange), but it is **not** a full OAuth/OIDC provider implementation. The goal is to provide:

- A safe way to **return the user to the relying party** after verification
- A safe way to **avoid putting sensitive data in the URL**
- A minimal way for the RP to retrieve **non-PII verification flags** via a one-time code

**Note:** PII disclosure is a separate, passkey‑consented flow (OIDC‑style). This doc only covers verification flags.

## Why this exists

Better Auth powers **authentication inside Zentity** (sessions, login, magic links, account creation).

This RP flow solves a separate problem: **how a third party requests verification and gets a result back** without exposing raw personal data or proofs via browser redirects.

## High-level sequence

1. RP redirects the user to Zentity:
   - `GET /api/rp/authorize?client_id=...&redirect_uri=...&state=...`
2. Zentity validates and replaces those params with a short-lived `flow` (UUID, ~2 min TTL):
   - Redirects user to `/rp/verify?flow=...`
   - Stores flow data in an **httpOnly signed cookie** (short TTL, tamper-resistant)
3. User completes onboarding/verification in Zentity
4. Zentity returns user back to RP:
   - `GET /api/rp/complete?flow=...` (requires user session)
   - Issues a **one-time authorization code**
   - Redirects user to `redirect_uri?code=...&state=...`
5. RP exchanges the code server-to-server:
   - `POST /api/rp/exchange { code, client_id? }`
   - Receives **verification flags only** (no raw PII): `verified`, `level`, `checks`

## Endpoints and responsibilities

### `GET /api/rp/authorize`

File: `apps/web/src/app/api/rp/[...path]/route.ts`

Responsibilities:

- Validate request parameters (`client_id`, `redirect_uri`, optional `state`)
- Enforce redirect allowlist for **external** redirect URIs (`RP_ALLOWED_REDIRECT_URIS`)
- Create a short-lived `flow` ID (UUID) and store flow state in an **httpOnly signed cookie**
- Redirect to a clean URL: `/rp/verify?flow=...`

Security value:

- Prevents sensitive params from persisting in the browser address bar, history, analytics, or referer headers.
- Signed cookies prevent tampering with `client_id` / `redirect_uri` / `state` stored in the flow.

### `GET /rp/verify`

File: `apps/web/src/app/rp/verify/page.tsx`

Responsibilities:

- Read and verify flow state from the signed cookie using `flow`
- Display a minimal “handoff” confirmation screen
- Route user into onboarding at `/sign-up?rp_flow=...`

### `GET /api/rp/complete`

File: `apps/web/src/app/api/rp/[...path]/route.ts`

Responsibilities:

- Require an authenticated user session
- Load and validate the `flow`
- Issue a one-time authorization `code` (UUID, ~5 min TTL) bound to `(client_id, redirect_uri, user_id)`
- Redirect back to the relying party with `code` (+ `state`)

Security value:

- A one-time code is safer than redirecting with verification results directly.

### `POST /api/rp/exchange`

File: `apps/web/src/app/api/rp/[...path]/route.ts`

Responsibilities:

- Consume the one-time code (single-use + expiry enforced in DB)
- Return minimal **verification status and checks** for the user associated with the code

Privacy value:

- Returns only coarse flags (e.g., `verified`, `level`, `checks`)—not DOB, document images, selfies, embeddings, or raw ZK proof payloads.

## Configuration

### `RP_ALLOWED_REDIRECT_URIS`

Defined in `.env` / `.env.example`.

- Comma-separated list of **exact** allowed external redirect URIs.
- Internal redirects (starting with `/`) are allowed for local testing and first-party flows.

## Current limitations

This is an MVP-style flow suitable for **closed beta** integrations, not a public open OAuth provider:

- No client registration UI or client secret management
- No PKCE or client authentication at exchange time
- No scopes/consent screen per RP
- The `/api/rp/complete` endpoint currently issues a code via `GET` (production systems typically use POST + CSRF)
- No signed verification token/JWT yet

If we want to productionize this for third-party partners at scale, we should add:

- A client registry (stored + managed), per-client keys/secrets, and metadata (name/logo)
- PKCE and redirect_uri binding checks on exchange
- Rate limiting, audit logging, and signed verification assertions

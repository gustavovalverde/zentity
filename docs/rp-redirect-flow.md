# OAuth Provider Flow (Better Auth)

This document describes **Better Auth’s OAuth 2.1 Provider**. Zentity acts as a standards‑based authorization server for partners who need **verified claims** (not raw PII).

Implementation note: OAuth provider endpoints are implemented by the Better Auth plugin (`@better-auth/oauth-provider`) and exposed under `/api/auth/oauth2/*` plus `/api/auth/.well-known/*` metadata.

## Why this exists

- Uses a **standardized OAuth 2.1 / OIDC‑compatible** flow
- Avoids custom redirect handling or cookie‑signed flow state
- Allows partners to integrate with existing OAuth libraries
- Keeps verification results **minimal and non‑PII**

## High‑level sequence

1. **Partner redirects the user to Zentity**
   - `GET /api/auth/oauth2/authorize?client_id=...&redirect_uri=...&scope=openid%20profile%20email&state=...`
2. **User authenticates** (if not already signed in)
   - Redirects to `/sign-in` (Better Auth login page)
3. **User consents**
   - Redirects to `/oauth/consent` (UI page in `apps/web/src/app/oauth/consent`)
   - Consent page calls `POST /api/auth/oauth2/consent` with `accept: true`
4. **Authorization code is returned**
   - Redirects back to partner with `code` + `state`
5. **Partner exchanges code for tokens**
   - `POST /api/auth/oauth2/token`
6. **Partner retrieves verified claims**
   - `GET /api/auth/oauth2/userinfo` (requires `openid`)

## Key endpoints

- `GET /api/auth/.well-known/oauth-authorization-server`
- `GET /api/auth/.well-known/openid-configuration` (if OpenID scope enabled)
- `GET /api/auth/oauth2/authorize`
- `POST /api/auth/oauth2/consent`
- `POST /api/auth/oauth2/continue`
- `POST /api/auth/oauth2/token`
- `POST /api/auth/oauth2/introspect`
- `POST /api/auth/oauth2/revoke`
- `GET /api/auth/oauth2/userinfo`
- `GET /api/auth/oauth2/end-session`

## Configuration

- OAuth clients are stored in the **Better Auth oauth client tables**.
- Redirect URIs are **defined per client**, not via env allowlists.
- Login page: `/sign-in`
- Consent page: `/oauth/consent`
- Scopes are limited to identity/VC needs (e.g. `openid`, `profile`, `email`, `vc:identity`).

## Privacy boundaries

- The OAuth provider returns **verified claims only** via OIDC4IDA `verified_claims`.
- **PII disclosure remains a separate, passkey‑consented flow.**
- Encrypted data is never returned without PRF‑based unlock on the client.

**Userinfo claims**: when identity assurance data is available, `/oauth2/userinfo` includes a `verified_claims` object with the verification context and claim flags.

## Related

- For partner integrations, create OAuth clients via Better Auth admin APIs or direct DB setup.
- For external identity providers (Generic OAuth), see `docs/oauth-integrations.md`.

# `api/oauth2/` — custom OAuth/OIDC endpoints

These routes implement OAuth/OIDC endpoints that are NOT part of the better-auth plugin surface. They live outside `api/auth/` so they do not collide with the better-auth `[...all]` catch-all handler.

Current routes:

- `authorize-challenge/` — First-Party Apps Authorization Challenge Endpoint (`draft-ietf-oauth-first-party-apps`). Used by CLI/headless clients and for step-up re-authentication. Supports OPAQUE (3-round) and EIP-712 wallet (2-round) challenge flows with DPoP-bound auth_session.
- `clients/` — RP admin client registration / lookup helpers (used by `/dashboard/dev/rp-admin`).
- `identity/` — ephemeral identity staging for OAuth consent (in-memory store, 5-min TTL).

For plugin-extended endpoints served alongside the better-auth OIDC provider (end-session, JWKS, PAR, proof-of-human), see `api/auth/oauth2/`.

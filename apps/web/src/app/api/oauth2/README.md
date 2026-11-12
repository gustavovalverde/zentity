# `api/oauth2/` — custom OAuth/OIDC endpoints

These routes implement OAuth/OIDC endpoints that are NOT part of the better-auth plugin surface. They live outside `api/auth/` so they do not collide with the better-auth `[...all]` catch-all handler.

Current routes:

- `identity/` — ephemeral identity staging for OAuth consent (in-memory store, 5-min TTL).

The First-Party Apps Authorization Challenge Endpoint (`draft-ietf-oauth-first-party-apps`) is a better-auth plugin endpoint at `/api/auth/oauth2/authorize-challenge` (`src/lib/auth/oidc/authorize-challenge.ts`), so the OAuth provider verifies its DPoP proofs and nonces. For other plugin-extended endpoints served alongside the better-auth OIDC provider (end-session, JWKS, PAR, proof-of-human), see `api/auth/oauth2/`.

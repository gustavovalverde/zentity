# `api/auth/oauth2/` — plugin-extended endpoints

These routes extend the better-auth `[...all]` catch-all handler with explicit, typed route.ts files. They sit under `api/auth/` because they are part of the better-auth OIDC provider surface and must share the same cookie/session scope as the catch-all.

Current routes:

- `jwks/` — JWKS endpoint exposed under the auth issuer.
- `par/` — Pushed Authorization Requests endpoint (PAR, HAIP-required).
- `proof-of-human/` — liveness assertion proving the authorization request is human-initiated.

For custom OAuth/OIDC endpoints that are NOT part of better-auth (e.g. First-Party Apps Authorization Challenge, RP-admin client CRUD, identity intent), see `api/oauth2/` (top-level).

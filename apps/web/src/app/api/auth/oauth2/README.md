# `api/auth/oauth2/` — plugin-extended endpoints

These routes extend the better-auth `[...all]` catch-all handler with explicit, typed route.ts files. They sit under `api/auth/` because they are part of the better-auth OIDC provider surface and must share the same cookie/session scope as the catch-all.

Current routes:

- `jwks/` — JWKS endpoint exposed under the auth issuer.
- `proof-of-human/` — liveness assertion proving the authorization request is human-initiated.

The First-Party Apps Authorization Challenge Endpoint is also served under this prefix, at `/api/auth/oauth2/authorize-challenge`. It is a better-auth plugin endpoint (`src/lib/auth/oidc/authorize-challenge.ts`) handled by the catch-all, so it has no route.ts here.

For custom OAuth/OIDC endpoints that are NOT part of better-auth (e.g. RP-admin client CRUD, identity intent), see `api/oauth2/` (top-level).

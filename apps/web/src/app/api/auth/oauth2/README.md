# `api/auth/oauth2/`: plugin-extended endpoints

These routes extend the better-auth `[...all]` catch-all handler with explicit, typed route.ts files. They sit under `api/auth/` because they are part of the better-auth OIDC provider surface and must share the same cookie/session scope as the catch-all.

Current routes:

- `jwks/`: JWKS endpoint exposed under the auth issuer.
- `proof-of-human/`: mints a DPoP-bound Proof-of-Human token (`poh+jwt`). An access token approved for one `x402_purchase` gets a single-use token for that merchant; any other access token with the `poh` scope gets a client-mode token for the client.

The First-Party Apps Authorization Challenge Endpoint is also served under this prefix, at `/api/auth/oauth2/authorize-challenge`. It is an endpoint of the `@better-auth/first-party-apps` plugin, configured in `src/lib/auth/oidc/first-party-apps.ts` and handled by the catch-all, so it has no route.ts here.

For custom OAuth/OIDC endpoints that are NOT part of better-auth (e.g. RP-admin client CRUD, identity intent), see `api/oauth2/` (top-level).

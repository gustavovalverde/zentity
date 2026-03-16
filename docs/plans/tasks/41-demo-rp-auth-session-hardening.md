# Task 41: Demo-rp Auth & Session Hardening

> Phase 3 of [Cross-App Auth Hardening](../cross-app-auth-hardening.md)
> Findings: #4 (Bearer for userinfo), #5 (BCL wrong JWKS/issuer), #6 (BCL missing audience)

## Status: Not started

## Problem

Three auth bugs in the demo-rp break OAuth flows and allow cross-RP attacks:

### DPoP for userinfo (#4)

`fetchUserInfo()` sends `Authorization: Bearer <token>` to Zentity's userinfo endpoint. Zentity enforces `requireDpop: true` globally, so all DPoP-bound access tokens are rejected when presented as Bearer. This breaks both the OAuth code flow profile sync and CIBA identity claim retrieval.

The same bug exists in the CIBA route's `action: "userinfo"` handler.

### BCL wrong JWKS/issuer (#5)

The backchannel logout handler defaults to `${ZENTITY_URL}/.well-known/jwks.json` for JWKS and verifies `issuer` against bare `ZENTITY_URL`. But Zentity:

- Serves signing keys at `/api/auth/oauth2/jwks`
- Signs tokens with issuer `${ZENTITY_URL}/api/auth`

So valid logout tokens fail verification on both JWKS fetch and issuer mismatch.

### BCL missing audience (#6)

The BCL handler only checks `issuer` on the logout token JWT — no `audience` constraint. Any Zentity-signed logout token (for any RP) can terminate demo-rp sessions for the `sub`.

## Solution

### DPoP for userinfo

`fetchUserInfo()` must generate a DPoP proof for the userinfo endpoint and send the access token with the `DPoP` scheme.

The demo-rp already has `createDpopClient` (used in `getToken` and the CIBA route's token exchange). Extend `fetchUserInfo` to accept a DPoP client or key pair and generate a proof for `GET {zentityUrl}/api/auth/oauth2/userinfo`.

For the `getUserInfo` callback in `makeProviderConfig`: the `getToken` custom handler already has a `dpop` client. Thread that DPoP client through to `fetchUserInfo` so it can generate the proof.

For the CIBA route: the `fetchTokenWithDpop` function already creates a DPoP client. Reuse it for the subsequent userinfo fetch.

### BCL OIDC Discovery

Replace hardcoded JWKS URL and issuer with values from OIDC Discovery:

1. Fetch `${ZENTITY_URL}/.well-known/openid-configuration` on first BCL request
2. Extract `jwks_uri` and `issuer` from the response
3. Cache the discovery response at module level (changes rarely — 1 hour TTL or no expiry for simplicity)
4. Use `jwks_uri` for `createRemoteJWKSet` and `issuer` for `jwtVerify`

This eliminates the `ZENTITY_JWKS_URL` env var override in the BCL handler — discovery is the single source of truth.

### BCL audience check

Add `audience` to the `jwtVerify` options. The audience should be the demo-rp's client ID that the logout token was minted for.

Since the demo-rp has multiple providers (bank, exchange, wine, aid, veripass, aether), the audience could be any of their client IDs. Two approaches:

**Recommended**: Collect all registered client IDs and pass them as an array to `jwtVerify`'s `audience` option (jose supports arrays — token must match at least one). This is simple and correct.

**Alternative**: Pre-decode the token header (without verification) to extract `aud`, check it's one of ours, then verify with that audience. More work for no benefit.

## Acceptance criteria

- [ ] `fetchUserInfo` sends `Authorization: DPoP <token>` with a valid DPoP proof
- [ ] CIBA route userinfo fetch sends DPoP (not Bearer)
- [ ] BCL handler fetches JWKS URI and issuer from OIDC Discovery
- [ ] BCL handler rejects logout tokens with wrong `aud` (different client ID)
- [ ] BCL handler accepts logout tokens with correct `aud`
- [ ] Discovery response is cached (not fetched on every BCL request)
- [ ] Test: userinfo call includes DPoP proof header
- [ ] Test: BCL with wrong audience returns 400
- [ ] Test: BCL with correct audience + valid token terminates sessions

## Notes

- `createDpopClient` creates a fresh ephemeral key pair each time. For `fetchUserInfo`, it needs to use the **same** key pair that was used for the token exchange (since the access token's `cnf.jkt` is bound to that key). Thread the DPoP client from `getToken` through to `getUserInfo`.
- The CIBA route already creates a DPoP client in `fetchTokenWithDpop` — extend it to also generate a proof for the subsequent userinfo call.
- For BCL discovery caching: use a simple module-level `let cached: { jwksUri, issuer } | null` with lazy initialization. No TTL needed for a demo app — restart clears the cache.

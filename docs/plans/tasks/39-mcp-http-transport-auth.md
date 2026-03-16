# Task 39: MCP HTTP Transport Auth

> Phase 1 of [Cross-App Auth Hardening](../cross-app-auth-hardening.md)
> Findings: #1 (credential forwarding), #2 (missing DPoP key), #3 (wrong JWKS path)

## Status: Not started

## Problem

The MCP server's HTTP transport has three co-dependent auth bugs that make all authenticated tool calls fail:

1. Token verifier fetches JWKS from `/api/auth/jwks` which doesn't exist (404). Should be `/api/auth/oauth2/jwks`.
2. `zentityFetch` in HTTP mode uses `serviceTokenFetch` which sends `X-Zentity-Internal-Token` / `X-Zentity-User-Id` headers. The web app's tRPC layer doesn't recognize these headers — it only resolves sessions from cookies or `Authorization` (Bearer/DPoP).
3. HTTP transport builds `AuthContext` with `privateJwk: {}` (empty). Any tool needing to originate a DPoP proof for downstream calls fails.

## Solution

**Relay the caller's DPoP-bound access token and proof end-to-end.** No internal service token path.

### Token verifier (token-auth module)

Change the JWKS URL from `/api/auth/jwks` to `/api/auth/oauth2/jwks`. This is the only JWKS endpoint Zentity exposes (confirmed by discovery metadata, demo-rp, and all internal consumers).

### HTTP transport auth context

The auth middleware already extracts the raw access token and validates the DPoP proof. Instead of building a degraded `AuthContext` with empty `privateJwk`, preserve the caller's original access token and DPoP proof so `zentityFetch` can relay them.

The HTTP transport `AuthContext` needs the caller's raw DPoP proof string in addition to the access token. Since DPoP proofs are bound to a specific `htm` (method) and `htu` (URL), the relayed proof is only valid for the same method/URL — but `zentityFetch` always targets Zentity's own APIs on the same origin, and the proof's freshness window (5 min) is more than enough for tool execution.

**Important caveat**: A single DPoP proof can only be used for one downstream request because `htu` is bound. For HTTP transport, `zentityFetch` must either:

- Generate a new proof using the caller's key (not possible — no private key)
- Relay the original proof only for the first downstream call

The practical fix: HTTP transport should forward the caller's `Authorization` and `DPoP` headers directly to downstream requests. This works because all downstream calls go to the same Zentity origin. If a tool makes multiple downstream calls with different URLs, the DPoP nonce retry mechanism handles it.

### Remove serviceTokenFetch

Delete `serviceTokenFetch` and all references to `X-Zentity-Internal-Token` / `X-Zentity-User-Id` in the MCP server. These headers are only recognized by FHE/OCR/FROST services, not by the web app's tRPC layer.

## Acceptance criteria

- [ ] `validateToken` fetches JWKS from `{zentityUrl}/api/auth/oauth2/jwks`
- [ ] HTTP-mode `zentityFetch` sends `Authorization: DPoP <token>` and `DPoP: <proof>` headers
- [ ] `serviceTokenFetch` function is deleted
- [ ] HTTP transport `AuthContext` carries the caller's original access token
- [ ] Test: token verification resolves keys from the correct JWKS endpoint
- [ ] Test: `zentityFetch` in HTTP mode relays DPoP headers to downstream URLs

## Notes

- stdio transport already works correctly — no changes needed there
- The `config.transport` branch in `zentityFetch` can be simplified since both transports now use the same DPoP relay pattern
- `INTERNAL_SERVICE_TOKEN` env var is no longer needed for the MCP server (it's still used by FHE/OCR/FROST services independently)

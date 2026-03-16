# PRD: Cross-App Auth & Protocol Hardening

## Problem Statement

Zentity's auth stack has evolved rapidly — DPoP enforcement went global, JWKS moved to `/api/auth/oauth2/jwks`, CIBA gained auto-approve and ping delivery modes, and the MCP server added HTTP transport. These changes were individually correct but exposed **11 integration-level bugs** across three apps (MCP server, demo-rp, web app) that break authenticated flows, allow cross-RP attacks, and silently skip notifications.

The bugs cluster into four attack surfaces:

1. **DPoP enforcement gaps** — Zentity enforces `requireDpop: true` globally, but the MCP HTTP transport and demo-rp still send Bearer tokens for userinfo and downstream API calls. Every authenticated flow through these paths fails.
2. **OIDC endpoint path drift** — The JWKS endpoint is at `/api/auth/oauth2/jwks`, but the MCP token verifier points at the non-existent `/api/auth/jwks`. HTTP-mode MCP cannot validate any token.
3. **Plugin bypass patterns** — CIBA auto-approve updates the DB directly without triggering ping delivery. The PAR after-hook updates the wrong row under concurrent requests. Both bypass the plugin's intended code path.
4. **Missing authorization boundaries** — Backchannel logout tokens are accepted without audience checks (cross-RP session termination), and post-logout redirects skip validation when `client_id` is absent (open redirect).

None of these bugs are caught by existing tests because they occur at integration boundaries between apps.

## Solution

A single coordinated hardening pass across all three apps that:

- Unifies DPoP token handling so every downstream call uses proof-of-possession
- Resolves OIDC endpoint references from discovery metadata instead of hardcoding paths
- Ensures CIBA plugin side-effects (ping delivery) fire even on optimized paths (auto-approve)
- Closes authorization boundary gaps in BCL and RP-initiated logout
- Fixes the MCP purchase tool's RAR shape to match the web app's expected structure

All fixes are backward-compatible — no schema changes, no new env vars, no breaking API changes.

## User Stories

1. As an MCP HTTP transport user, I want my authenticated MCP requests to succeed, so that tools like `whoami`, `my_proofs`, and `check_compliance` work regardless of transport mode.
2. As an MCP HTTP transport user, I want my DPoP-bound access token to be relayed to downstream Zentity APIs, so that proof-of-possession is maintained end-to-end.
3. As an MCP HTTP transport user, I want the token verifier to resolve signing keys from the correct JWKS endpoint, so that my Bearer/DPoP tokens are validated successfully.
4. As an MCP user making a purchase, I want the purchase amount to appear in my approval notification and be checked against my boundary policies, so that I can see what I'm approving and my spending limits are enforced.
5. As a demo-rp user completing an OAuth login, I want my userinfo fetch to succeed after token exchange, so that my profile and claims are synced correctly.
6. As a demo-rp user completing a CIBA flow, I want my identity claims to be fetched successfully via userinfo, so that the agent receives the PII I approved.
7. As a demo-rp operator, I want backchannel logout tokens to be verified against the correct issuer and JWKS, so that valid logout signals from Zentity are honored.
8. As a demo-rp operator, I want backchannel logout tokens to be rejected if they were minted for a different RP, so that another RP cannot terminate my users' sessions.
9. As a CIBA ping-mode client, I want to receive a notification when my request is auto-approved by a boundary policy, so that I don't have to poll or time out waiting.
10. As a Zentity operator, I want the PAR resource field to be stored on the correct pushed request row, so that concurrent PAR submissions from the same client don't cross-contaminate.
11. As a user logging out via RP-initiated logout, I want the post-logout redirect URI to be validated even when `client_id` is absent, so that I'm not redirected to an attacker-controlled URL.
12. As a developer, I want the demo-rp's OIDC configuration (JWKS URI, issuer) to be resolved from discovery metadata, so that path changes in Zentity don't silently break the demo-rp.

## Implementation Decisions

### MCP Server (apps/mcp)

**JWKS path fix (finding #3):**

- Change the JWKS URL in the token verifier from `/api/auth/jwks` to `/api/auth/oauth2/jwks`.

**DPoP relay for HTTP transport (findings #1, #2):**

- Remove `serviceTokenFetch` entirely. HTTP transport should relay the caller's original DPoP-bound access token and proof to downstream Zentity APIs, the same way stdio transport does.
- The HTTP transport auth middleware already extracts the access token and DPoP public JWK. The key change is to preserve the full token for relay rather than replacing it with internal service token headers.
- Since the HTTP transport cannot originate new DPoP proofs (no private key), all downstream calls must reuse the caller's proof. This means downstream calls must happen within the DPoP proof's freshness window (5 minutes), which is acceptable for tool execution.

**Purchase RAR shape (finding #11):**

- Change the `authorization_details` from flat `{ amount, currency }` to nested `{ amount: { value: string, currency: string } }` to match the RAR shape expected by boundary evaluation, email mailer, approval UI, and push notifications.
- The `amount` value must be a string (e.g., `"9.99"`) matching the pattern used by the demo-rp Aether AI scenario and all web app consumers.

### Demo-rp (apps/demo-rp)

**DPoP for userinfo (finding #4):**

- `fetchUserInfo()` in `auth.ts` must generate a DPoP proof and send the access token as `DPoP` scheme instead of `Bearer`.
- The CIBA route's userinfo fetch must do the same.
- Reuse the existing `createDpopClient` utility already imported in the CIBA route.

**BCL handler (findings #5, #6):**

- Replace the hardcoded JWKS URL and issuer with values fetched from OIDC Discovery (`/.well-known/openid-configuration`). Cache the discovery response (it changes rarely).
- Add an `audience` constraint to `jwtVerify` for logout tokens. The audience should be the demo-rp's client ID for the provider that issued the token. Since multiple providers may exist, extract the `aud` claim from the token first (pre-verify decode), then validate the full JWT with the audience constraint.

### Web App (apps/web)

**CIBA auto-approve ping delivery (finding #7):**

- After `tryAutoApprove` returns `true` in the `sendNotification` callback, check the CIBA request's `deliveryMode`. If it's `"ping"`, call `deliverPing()` with the `clientNotificationEndpoint` and `clientNotificationToken` from the DB row.
- `tryAutoApprove` already queries the `cibaRequests` row — extend it to return the delivery mode and notification fields alongside the approval result.

**PAR hook race (finding #8):**

- Pass the generated `requestId` through the hook context so `afterParPersistResource` can update the exact row instead of querying by clientId + newest. This eliminates the race condition entirely.
- If the plugin doesn't expose the requestId in the hook context, fall back to filtering by `clientId AND resource IS NULL` to only update rows that haven't been resourced yet.

**Post-logout redirect validation (finding #9):**

- When `client_id` is absent but `post_logout_redirect_uri` is present, extract `azp` (or the first element of `aud` if it's an array) from the verified `id_token_hint` payload. Use that as the effective client ID for redirect URI validation.
- This aligns with OIDC RP-Initiated Logout 1.0 which states that `client_id` is optional when `id_token_hint` is provided.

### Not Changed

**Ephemeral claims keying (finding #10):**

- The ephemeral store's `userId:clientId` keying is a known design limitation, not a data integrity bug. It rejects concurrent staging with a clear `409 concurrent_stage` error. No change needed for this PRD; a future enhancement could key by `auth_req_id` if multi-request identity staging becomes a requirement.

**tRPC JSON envelope (finding #12 — invalid):**

- Zentity's tRPC uses the default transformer (no superjson), so raw JSON input without `{"json": ...}` wrapping is correct. No change needed.

## Testing Decisions

Good tests for this PRD verify **observable behavior at integration boundaries** — the exact level where these bugs live. Tests should not mock the auth stack internals but should verify that the correct headers, tokens, and payloads reach the downstream endpoint.

### MCP token-auth + api-client

- **Token verification**: Test that `validateToken` resolves keys from `/api/auth/oauth2/jwks` (mock the JWKS endpoint, verify the URL it fetches).
- **DPoP relay**: Test that `zentityFetch` in HTTP mode sends the caller's `Authorization: DPoP <token>` and `DPoP: <proof>` headers to downstream URLs, not `X-Zentity-Internal-Token`.
- Prior art: `apps/mcp/src/auth/__tests__/` if it exists, or `apps/mcp/vitest.config.*`

### CIBA auto-approve + ping

- **Ping delivery on auto-approve**: Test that when `tryAutoApprove` succeeds for a ping-mode request, the `sendNotification` callback calls `deliverPing` with the correct endpoint and token.
- **Poll mode unchanged**: Test that poll-mode auto-approved requests do NOT call `deliverPing` (no regression).
- Prior art: `apps/web/src/lib/auth/__tests__/ciba-token.integration.test.ts`

### End-session + BCL validation

- **Redirect without client_id**: Test that `GET /api/auth/oauth2/end-session?id_token_hint=...&post_logout_redirect_uri=https://evil.com` is rejected when the URI doesn't match the `azp` client's registered URIs, even without `client_id` in the query.
- **Redirect with valid azp**: Test that a valid `post_logout_redirect_uri` matching the `azp` client's registered URIs succeeds without `client_id`.
- **BCL audience check**: Test that the demo-rp BCL handler rejects a logout token with `aud` set to a different client ID.
- Prior art: `apps/web/src/lib/auth/__tests__/`, `apps/demo-rp/src/**/*.test.*`

### Purchase RAR shape

- **Shape validation**: Test that the MCP purchase tool sends `authorization_details` with `amount: { value: "...", currency: "..." }` (not flat fields).
- Prior art: `apps/web/src/lib/push/__tests__/ciba-payload.test.ts` (uses the expected shape)

## Out of Scope

- **Internal service token auth for tRPC** — Decided to relay DPoP instead. If a future need arises for service-to-service tRPC calls without user tokens, that's a separate effort.
- **Per-auth_req_id ephemeral claim keying** — Finding #10 is a design limitation that fails cleanly. Future enhancement if multi-request identity staging is needed.
- **CIBA push-mode delivery beyond auto-approve** — Only the auto-approve path is missing ping delivery. The manual approval path already triggers the plugin's authorize endpoint correctly.
- **DPoP enforcement in demo-rp refresh token flows** — Only the initial userinfo fetch and CIBA userinfo are in scope. Refresh token rotation with DPoP is a separate concern.
- **MCP stdio transport changes** — stdio mode already works correctly with DPoP relay.

## Further Notes

- **Deployment order matters**: The MCP JWKS fix (#3) should be deployed first since it's the simplest change and unblocks all HTTP-mode MCP functionality. The DPoP relay (#1, #2) can follow.
- **Discovery caching in demo-rp**: The OIDC Discovery fetch for BCL should cache the response in a module-level variable with a reasonable TTL (e.g., 1 hour). Discovery metadata changes rarely and the BCL handler is called infrequently.
- **PAR hook context**: If the better-auth HAIP plugin doesn't expose `requestId` in the after-hook context, a targeted patch to the vendor tarball may be needed (similar to the existing oauth-provider patch). Alternatively, `clientId AND resource IS NULL` is a viable zero-patch fallback.
- **DPoP proof freshness for HTTP relay**: The relayed DPoP proof must be fresh enough (within 5-minute `iat` window) for downstream Zentity validation. Since MCP tool execution is fast (sub-second for most tools), this is not a practical concern. If a tool takes longer (e.g., CIBA polling), the proof may expire — but CIBA polling already handles nonce retry.

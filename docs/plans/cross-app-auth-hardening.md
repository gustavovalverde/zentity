# Plan: Cross-App Auth & Protocol Hardening

> Source PRD: `docs/plans/prd-cross-app-auth-hardening.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Auth model for MCP HTTP transport**: Relay the caller's DPoP-bound access token and proof to downstream Zentity APIs. No internal service token path. `serviceTokenFetch` is removed entirely.
- **OIDC Discovery as source of truth**: Demo-rp resolves JWKS URI and issuer from `/.well-known/openid-configuration` instead of hardcoding paths. Cached with a reasonable TTL.
- **DPoP everywhere**: All consumers (MCP, demo-rp) must send DPoP-bound tokens to Zentity's userinfo and tRPC endpoints. Bearer is only acceptable for endpoints that don't enforce DPoP.
- **No schema changes**: All fixes are auth/protocol logic. No DB migrations, no new tables, no column changes.
- **No new env vars**: Fixes use existing configuration. OIDC Discovery eliminates the need for `ZENTITY_JWKS_URL` in demo-rp BCL.
- **Breaking changes allowed**: `serviceTokenFetch` removal, DPoP enforcement on demo-rp calls. No users in production, so breaking changes are acceptable per project policy.

---

## Phase 1: MCP HTTP Transport Auth

**Task**: `docs/plans/tasks/39-mcp-http-transport-auth.md`
**Findings**: #1 (credential forwarding), #2 (missing DPoP key), #3 (wrong JWKS path)
**User stories**: 1, 2, 3

### What to build

Fix the MCP server's HTTP transport so authenticated tool calls succeed end-to-end. Three co-dependent changes:

1. **JWKS resolution**: Point the token verifier at `/api/auth/oauth2/jwks` (the actual endpoint) instead of `/api/auth/jwks` (404).
2. **DPoP relay**: HTTP transport preserves the caller's full access token and DPoP proof, then `zentityFetch` relays both to downstream Zentity APIs using `Authorization: DPoP <token>` + `DPoP: <proof>` headers.
3. **Remove serviceTokenFetch**: Delete the internal service token path entirely since it targets headers the web app doesn't recognize.

### Acceptance criteria

- [ ] `validateToken` fetches JWKS from `{zentityUrl}/api/auth/oauth2/jwks`
- [ ] HTTP-mode `zentityFetch` sends `Authorization: DPoP <token>` and `DPoP: <proof>` headers (not `X-Zentity-Internal-Token`)
- [ ] `serviceTokenFetch` function is deleted
- [ ] HTTP transport `AuthContext` carries the caller's original access token
- [ ] Test: token verification resolves keys from the correct JWKS endpoint
- [ ] Test: `zentityFetch` in HTTP mode relays DPoP headers to downstream URLs

---

## Phase 2: MCP Purchase Authorization Shape

**Task**: `docs/plans/tasks/40-mcp-purchase-authorization-shape.md`
**Finding**: #11 (RAR shape mismatch)
**User story**: 4

### What to build

Fix the MCP purchase tool's `authorization_details` payload to use the nested RAR shape that the web app's boundary evaluation, email mailer, approval UI, and push notifications all expect.

The current flat shape `{ amount: 42, currency: "USD" }` must become `{ amount: { value: "9.99", currency: "USD" } }` to match the canonical shape used by the demo-rp Aether AI and all web app consumers.

### Acceptance criteria

- [ ] Purchase tool sends `authorization_details` with `amount: { value: string, currency: string }` (nested object, value as string)
- [ ] `amount` at the top level of the detail object is the nested object, not a flat number
- [ ] Test: verify the `authorization_details` shape matches what `boundary-evaluation.ts` expects (`purchase.amount.value`, `purchase.amount.currency`)

---

## Phase 3: Demo-rp Auth & Session Hardening

**Task**: `docs/plans/tasks/41-demo-rp-auth-session-hardening.md`
**Findings**: #4 (Bearer for userinfo), #5 (BCL wrong JWKS/issuer), #6 (BCL missing audience)
**User stories**: 5, 6, 7, 8, 12

### What to build

Three fixes in the demo-rp, all related to how it authenticates with Zentity:

1. **DPoP for userinfo**: `fetchUserInfo()` in `auth.ts` and the CIBA route's userinfo fetch must generate a DPoP proof and use `Authorization: DPoP <token>` instead of `Bearer`. Reuse the existing `createDpopClient` utility.

2. **BCL OIDC Discovery**: The backchannel logout handler must resolve JWKS URI and issuer from Zentity's `/.well-known/openid-configuration` instead of hardcoding `/.well-known/jwks.json` and bare `ZENTITY_URL`. Cache the discovery response at module level.

3. **BCL audience check**: Add an `audience` constraint to the logout token `jwtVerify` call. The audience should be the demo-rp's client ID. Since multiple providers exist, extract the provider from the token's `aud` claim and validate accordingly.

### Acceptance criteria

- [ ] `fetchUserInfo` sends `Authorization: DPoP <token>` with a valid DPoP proof
- [ ] CIBA route userinfo fetch sends DPoP (not Bearer)
- [ ] BCL handler fetches JWKS URI and issuer from OIDC Discovery
- [ ] BCL handler rejects logout tokens with wrong `aud` (different client ID)
- [ ] BCL handler accepts logout tokens with correct `aud`
- [ ] Discovery response is cached (not fetched on every BCL request)
- [ ] Test: userinfo call includes DPoP proof header
- [ ] Test: BCL with wrong audience returns 400
- [ ] Test: BCL with correct audience + valid token terminates sessions

---

## Phase 4: CIBA Auto-Approve Ping Delivery

**Task**: `docs/plans/tasks/42-ciba-auto-approve-ping-delivery.md`
**Finding**: #7 (ping not emitted on auto-approve)
**User story**: 9

### What to build

When `tryAutoApprove` succeeds for a ping-mode CIBA request, the `sendNotification` callback must call `deliverPing()` before returning. Currently it returns immediately after auto-approval, skipping all notification delivery.

1. **Extend tryAutoApprove return value**: Return the CIBA request's `deliveryMode`, `clientNotificationEndpoint`, and `clientNotificationToken` alongside the approval boolean. The DB row already has these fields.

2. **Deliver ping in sendNotification**: After `tryAutoApprove` returns true, check if `deliveryMode === "ping"` and call `deliverPing(endpoint, token, authReqId)`. Poll-mode requests need no notification (client polls on its own).

### Acceptance criteria

- [ ] `tryAutoApprove` returns delivery metadata (mode, endpoint, token) when approval succeeds
- [ ] `sendNotification` calls `deliverPing` for ping-mode auto-approved requests
- [ ] `sendNotification` does NOT call `deliverPing` for poll-mode auto-approved requests
- [ ] Test: auto-approve of ping-mode request triggers `deliverPing` with correct endpoint and token
- [ ] Test: auto-approve of poll-mode request does not trigger `deliverPing`

---

## Phase 5: OAuth Provider Protocol Compliance

**Task**: `docs/plans/tasks/43-oauth-provider-protocol-compliance.md`
**Findings**: #8 (PAR hook race), #9 (post-logout redirect bypass)
**User stories**: 10, 11

### What to build

Two protocol compliance fixes in the web app's OAuth provider layer:

1. **PAR hook correlation**: `afterParPersistResource` must update the exact PAR row created by the current request, not the newest row for the client. Pass the generated `requestId` through the hook context so the after-hook can filter by it. If the plugin doesn't expose requestId in the context, use a targeted patch or fall back to `clientId AND resource IS NULL`.

2. **End-session redirect validation without client_id**: When `post_logout_redirect_uri` is present but `client_id` is absent, extract `azp` (or the first element of `aud`) from the verified `id_token_hint` payload. Use that as the effective client ID for redirect URI validation. This aligns with OIDC RP-Initiated Logout 1.0 where `client_id` is optional when `id_token_hint` is provided.

### Acceptance criteria

- [ ] `afterParPersistResource` updates the row matching the current request's `requestId`
- [ ] Concurrent PAR requests from the same client update their own rows (no cross-contamination)
- [ ] End-session validates `post_logout_redirect_uri` against `azp`/`aud` from `id_token_hint` when `client_id` is absent
- [ ] End-session rejects unregistered `post_logout_redirect_uri` even without `client_id`
- [ ] End-session allows registered `post_logout_redirect_uri` when inferred client matches
- [ ] Test: two PAR requests in flight update their own resource fields
- [ ] Test: `GET /end-session?id_token_hint=...&post_logout_redirect_uri=https://evil.com` returns 400 when URI not registered for the azp client
- [ ] Test: valid redirect URI for the azp client succeeds without `client_id`

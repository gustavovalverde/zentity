# Task 10: Back-Channel Logout

> Source: `oidc-back-channel-logout.md`
> Priority: **P2** — RP sessions persist after Zentity logout; required for OIDC-conformant RPs
> Estimate: ~3 days

## Architectural decisions

- **Logout token**: Signed JWT per OIDC Back-Channel Logout 1.0 Section 2.4, containing `sub` (pairwise-aware), `sid`, `aud`, `jti`, and `events` claim
- **Signing**: Same algorithm as the client's ID tokens (via `id_token_signed_response_alg`, default RS256), using existing `signJwt` dispatcher
- **Delivery**: Fire-and-forget POST to each RP's `backchannel_logout_uri` as `application/x-www-form-urlencoded`, 2 retries with exponential backoff (1s, 3s)
- **DCR extension**: `backchannel_logout_uri` (HTTPS required in prod) and `backchannel_logout_session_required` (boolean)
- **End-session endpoint**: `{issuer}/oauth2/end-session` accepting `id_token_hint`, `post_logout_redirect_uri`, `client_id`, `state`
- **CIBA interaction**: Pending CIBA requests marked expired/rejected on logout

---

## What to build

Implement OIDC Back-Channel Logout 1.0, enabling Zentity to notify registered RPs when a user session ends, plus an `end_session_endpoint` for RP-initiated logout.

End-to-end: DCR schema extension → `logout_token` JWT construction and signing → async delivery with retry on session termination → `end_session_endpoint` route → `sid` claim in ID tokens for BCL-registered clients → CIBA revocation on logout → discovery metadata (`backchannel_logout_supported`, `end_session_endpoint`) → demo-rp `/api/auth/backchannel-logout` receiver → demo-rp "Session ended by Zentity" banner → tests.

### Acceptance criteria

- [x] DCR accepts `backchannel_logout_uri` and `backchannel_logout_session_required`
- [x] `logout_token` structure correct: `iss`, `sub` (pairwise), `aud`, `iat`, `jti`, `sid`, `events`
- [x] `logout_token` signed with client's ID token algorithm
- [x] Delivery POSTs to all registered RPs on session termination
- [x] Delivery retries on 5xx (2 retries, exponential backoff)
- [x] Delivery timeout does not block user's logout
- [x] `end_session_endpoint` validates `id_token_hint`, terminates session, triggers BCL delivery
- [x] `post_logout_redirect_uri` validated against registered URIs (invalid → error)
- [x] `sid` included in ID tokens for BCL-registered clients
- [x] Pending CIBA requests revoked on logout
- [x] Discovery advertises `backchannel_logout_supported`, `backchannel_logout_session_supported`, `end_session_endpoint`
- [ ] Demo-rp receives and verifies `logout_token`, invalidates session, shows banner
- [ ] Integration test: authorize → logout → verify test server received valid `logout_token`
- [ ] Integration test: `end_session_endpoint` with redirect
- [ ] Integration test: delivery retry on transient failure

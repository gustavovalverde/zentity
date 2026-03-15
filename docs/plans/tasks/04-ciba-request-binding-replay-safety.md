# Task 04: CIBA Request Binding & Replay Safety

> Source: `ciba-notifications-remediation.md` Phases 2 & 3
> Priority: **P0** — release handles are userId-scoped (cross-flow PII exfiltration), intent tokens lack request binding
> Estimate: ~2-3 days

## Architectural decisions

- **Intent tokens are per-request**: CIBA identity intent payloads include `authReqId`, staging verifies exact match
- **Release handles are request-scoped**: Store keyed by `authReqId` (not `userId`), with user/client values in the durable approval row for validation
- **Atomic single-use redemption**: Claim step runs inside a transaction — exactly one caller succeeds, concurrent callers fail before any `id_token` is returned
- **Rollback safety**: If decrypt/sign fails after claim, transaction must not leave the approval permanently redeemed
- **Non-CIBA grants never consume release handles**: Token minting path only consumes a handle for the matching CIBA request

---

## What to build

Two tightly coupled fixes that together close the CIBA privacy boundary:

**Intent binding (Phase 2):** Extend CIBA identity intent payload with `authReqId`. Update `/api/ciba/identity/intent` to pass the current `auth_req_id`. Update `/api/ciba/identity/stage` to verify `intentPayload.authReqId === auth_req_id`. Persist `cibaRequest.authorizationDetails` into the `approvals` row during staging.

**Replay safety (Phase 3):** Replace `userId`-keyed release-handle store with `authReqId`-scoped key. Adjust `customAccessTokenClaims` to only consume a staged handle for the matching CIBA token request. Rework `/api/oauth2/release` so redemption is claimed atomically inside a transaction.

End-to-end: intent token schema change → staging verification → request-scoped handles → `authorization_details` persistence → atomic redemption → concurrency tests.

### Acceptance criteria

- [x] CIBA intent tokens carry `authReqId` (already implemented)
- [x] Staging rejects an otherwise-valid intent token when minted for a different `auth_req_id` (already implemented, tested in intent-binding.integration.test.ts)
- [x] Same-client, same-scope concurrent requests require distinct intent tokens (already implemented)
- [x] `authorization_details` survive staging and appear in the release-issued `id_token` (already implemented — stage persists, release returns)
- [x] Concurrent or interleaved token issuance for the same user cannot steal another request's `release_handle` (fixed: CIBA plugin now passes authReqId as referenceId)
- [x] A staged handle is only ever attached to the CIBA token for the matching request (fixed: consumeReleaseHandle uses authReqId directly)
- [x] Refresh tokens, auth-code tokens, and token-exchange outputs do not consume staged CIBA release handles (identity scope guard in customAccessTokenClaims)
- [x] Two concurrent `POST /api/oauth2/release` calls yield exactly one success and one replay-style failure (CAS-based `claiming` status transition)
- [x] Transaction rollback preserves redeemability if decryption or signing fails mid-request (rollback to `approved` in catch blocks)
- [x] Integration test: replaying an intent token against a second request fails with `400` (intent-binding.integration.test.ts)
- [x] Integration test: staged approval with `authorization_details` round-trips through `/api/oauth2/release` (ciba-release-lifecycle.integration.test.ts)
- [x] Integration test: same user with two pending CIBA requests gets the correct handle on each token (ciba-token.integration.test.ts)
- [ ] Integration test: unrelated token issuance between staging and CIBA token minting does not consume the pending handle
- [x] Integration test: concurrent release redemption preserves one-time-use semantics (ciba-release-lifecycle.integration.test.ts)

> **Status**: Complete — core security fix (authReqId scoping) committed as 1feaca05. Remaining items were found already implemented.

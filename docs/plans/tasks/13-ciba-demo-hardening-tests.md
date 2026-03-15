# Task 13: CIBA Demo Hardening & Regression Tests

> Source: `ciba-notifications-remediation.md` Phases 4 & 5
> Priority: **P2** — demo-rp ping/poll race condition; no automated regression coverage for CIBA findings
> Estimate: ~2 days
> Dependencies: Tasks 04, 05 (CIBA fixes must land first)

## Architectural decisions

- **Ping is an accelerator, not a second fetch path**: Ping can wake the client early, but must maintain a single in-flight token request
- **Monotonic state transitions**: Once the flow reaches `approved`, later poll responses cannot demote to `error`/`denied`/`expired`
- **One regression test per finding**: Each of the 7 CIBA findings from the remediation plan gets at least one automated test

---

## What to build

**A. Demo-rp ping flow hardening (Phase 4):** Fix the race condition in `apps/demo-rp/src/hooks/use-ciba-flow.ts` where a ping-triggered fast-path fetch can overlap with interval polling, and a successful token response can be overwritten by `invalid_grant` from a stale poll.

**B. Regression test backfill (Phase 5):** Write one automated test per CIBA finding to prevent regression during future refactors.

End-to-end: single in-flight guard in `use-ciba-flow.ts` → monotonic state machine → regression tests for all 7 findings → verify tests fail on old code, pass on new.

### Acceptance criteria

- [ ] Ping-triggered token fetch does not overlap unsafely with interval polling
- [ ] A successful token response cannot be overwritten by `invalid_grant` from a second request
- [ ] Demo UI remains in `approved` once a token has been obtained
- [ ] Regression test: push endpoint ownership transfer across users (Finding 1)
- [ ] Regression test: identity-scoped notification routing (Finding 3)
- [ ] Regression test: request-bound intent tokens (Finding 5)
- [ ] Regression test: `authorization_details` persistence through staging (Finding 6)
- [ ] Regression test: release-handle scoping per request (Finding 2)
- [ ] Regression test: concurrent redemption single-use (Finding 4)
- [ ] Regression test: ping/poll race (Finding 7)
- [ ] Test names explicitly describe the failure mode they guard against

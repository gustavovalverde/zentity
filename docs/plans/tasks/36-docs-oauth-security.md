# Task 36: Documentation — OAuth Security & Token Exchange

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 23
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document OAuth security hardening and RFC 8693 token exchange.

**Documents to update:**

- `docs/oauth-integrations.md` — token exchange section, security hardening
- `docs/agentic-authorization.md` — agent token exchange flows
- Update RFC-0033 gap table to mark implemented items

**Key content:**

- RFC 8693 Token Exchange: 3 modes (delegation, impersonation, scope narrowing)
- Scope attenuation: ID token subjects default to `["openid"]`
- `at_hash` in token exchange responses
- DPoP mandatory (`requireDpop: true`) across all endpoints
- `software_statement` handling in DCR
- `act` claim nesting per `draft-oauth-ai-agents-on-behalf-of-user`

## Acceptance criteria

- [x] Token exchange 3 modes documented with examples
- [x] Scope attenuation policy documented
- [x] DPoP enforcement documented
- [x] RFC-0033 gap table updated with implementation status

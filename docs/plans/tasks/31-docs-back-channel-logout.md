# Task 31: Documentation — Back-Channel Logout

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 18
> Status: Complete
> Priority: P2
> User Stories: 17

## What to build

Document OIDC Back-Channel Logout implementation.

**Documents to update:**

- `CLAUDE.md` (root) — OAuth Provider section, BCL subsection
- `docs/architecture.md` — logout flow in data flow diagrams
- `docs/oauth-integrations.md` — BCL protocol, DCR extension, logout token format
- `docs/tamper-model.md` — session termination as integrity control

**Key content:**

- `end_session_endpoint` at `GET /api/auth/oauth2/end-session`
- `id_token_hint` validation and session termination
- `sendBackchannelLogout()` — fire-and-forget delivery with 2 retries
- `sid` claim injection for BCL-registered clients
- `revokePendingCibaOnLogout()` — CIBA cancellation on logout
- DCR fields: `backchannel_logout_uri`, `backchannel_logout_session_required`
- Discovery: `backchannel_logout_supported: true`

## Acceptance criteria

- [ ] BCL protocol flow documented in oauth-integrations.md
- [ ] `end_session_endpoint` documented
- [ ] CIBA cancellation on logout documented
- [ ] Discovery metadata additions documented

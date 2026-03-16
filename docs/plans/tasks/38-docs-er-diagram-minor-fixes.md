# Task 38: Documentation — ER Diagram Sync & Minor Fixes

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 4
> Source plan: [documentation-sync-ciba-branch.md](../documentation-sync-ciba-branch.md) — Task 25
> Status: Complete
> Priority: P2
> User Stories: 16

## What to build

Sync the Mermaid ER diagram with all schema changes from the branch, plus minor doc fixes.

**Documents to update:**

- `docs/attestation-privacy-architecture.md` — ER diagram
- `docs/noir-profiling.md` — command fix
- `apps/landing/README.md` — new page

**Key content:**

- Add tables to ER diagram: `recovery_key_pins`, `ciba_requests`, `push_subscriptions`, `agent_boundaries`, `haip_pushed_requests`, `haip_vp_sessions`
- Add new columns from tasks 32 (dedup_key), 35 (revokedAt/By/Reason), etc.
- Replace `bun run` with `pnpm run` in noir-profiling.md
- Add `/agents` page to landing README

## Acceptance criteria

- [x] ER diagram includes all new tables from the branch
- [x] ER diagram includes all new columns (dedup_key, revocation fields, agentClaims, etc.)
- [x] `bun run` → `pnpm run` fixed in noir-profiling.md (already correct, no change needed)
- [x] Landing README updated with `/agents` page (already present, no change needed)

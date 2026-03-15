# Task 01: Step-Up Hook Fix

> Source: `security-findings-remediation.md` Finding 1
> Priority: **P0** — step-up enforcement is completely dead
> Estimate: ~1 hour

## Architectural decisions

- **Session resolution**: Use `getSessionFromCtx(ctx)` from `better-auth/api` — the canonical pattern already used in `eip712/server.ts`
- **No manual cookie parsing**: Remove `SESSION_COOKIE_RE`, `resolveSessionToken()`, and `resolveSession()` entirely
- **Hook context**: `ctx` already carries `ctx.context.secret` and `ctx.context.authCookies` — `getSessionFromCtx` uses these internally

---

## What to build

Replace the manual cookie regex parsing and direct DB query in `step-up-hook.ts` with better-auth's own `getSessionFromCtx(ctx)`. The current code extracts the full signed cookie value (`token.signature`) but compares it against `sessions.token` which stores only the raw token — the `WHERE` clause never matches, so `enforceStepUp()` silently short-circuits. Neither `acr_values` nor `max_age` enforcement ever runs.

This is a one-line fix by design — no manual cookie format handling means no format mismatch.

End-to-end: fix session resolution → verify `acr_values` enforcement (PAR and direct flows) → verify `max_age` enforcement → verify `prompt=none` + `max_age` → integration tests.

### Acceptance criteria

- [x] `SESSION_COOKIE_RE`, `resolveSessionToken()`, and `resolveSession()` removed from `step-up-hook.ts`
- [x] `sessions` schema import removed from `step-up-hook.ts`
- [x] Both `resolveSession(ctx.headers, db)` call sites replaced with `getSessionFromCtx(ctx)`
- [x] `SessionInfo` type updated to match `getSessionFromCtx` return shape
- [x] `acr_values` satisfied → token issued normally
- [x] `acr_values` not satisfied → redirect to RP with `interaction_required`
- [x] `max_age` exceeded → redirect to sign-in
- [x] `max_age` + `prompt=none` → redirect to RP with `login_required`
- [x] PAR-based flow with `acr_values` → same enforcement as direct flows
- [x] Missing/invalid cookie → hook skips gracefully (no crash)
- [x] Integration test: full `enforceStepUp` flow end-to-end with real better-auth context

> **Status**: Complete (commit a7da9570)

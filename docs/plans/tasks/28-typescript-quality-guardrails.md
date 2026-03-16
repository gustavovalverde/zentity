# Task 28: TypeScript Quality Guardrails

> Source PRD: [prd-production-launch.md](../prd-production-launch.md) — Module 3
> Status: Complete (4 of 5 flags; exactOptionalPropertyTypes blocked by better-auth InferAPI)
> Priority: P1 (parallel track — no feature dependencies)
> User Stories: 10, 11, 12, 13

## Architectural decisions

- **No `erasableSyntaxOnly` or `verbatimModuleSyntax`**: These conflict with Next.js SWC transform and better-auth plugin patterns. Skip them.
- **`noFloatingPromises` override removal**: Remove both Biome override blocks (hooks, dashboard pages). Fix all resulting violations with explicit `void` prefix or `.catch()`.
- **CLAUDE.md as guardrail documentation**: Add a "TypeScript Patterns" section to `apps/web/.claude/CLAUDE.md` so AI agents follow the same discipline.

---

## What to build

Enable additional TypeScript compiler strict flags, re-enable `noFloatingPromises` globally in Biome, and fix all resulting violations.

**`tsconfig.json` flags to enable:**

- `noUncheckedIndexedAccess` — array/object index returns `T | undefined`
- `exactOptionalPropertyTypes` — prevents `{ key: undefined }` for optional properties
- `noImplicitReturns` — every code path must return
- `noFallthroughCasesInSwitch` — switch cases must break/return
- `noImplicitOverride` — class method overrides must use `override` keyword

**`biome.json` changes:**

- Remove the two override blocks that disable `noFloatingPromises` for `src/hooks/**` and `src/app/(dashboard)/**`
- Fix all violations (estimated 4–5 genuine floating promises)

**`apps/web/.claude/CLAUDE.md` additions:**

- TypeScript Patterns section: type assertion discipline (`as` only at system boundaries), discriminated unions over boolean flags, `void` prefix for intentional fire-and-forget, explicit `undefined` checks for indexed access

**Execution approach:**

1. Enable one flag at a time, fix violations, commit
2. `noUncheckedIndexedAccess` first (highest violation count ~100-150, highest value)
3. `exactOptionalPropertyTypes` second
4. Remaining flags (low violation count)
5. `noFloatingPromises` last (requires careful async analysis)

---

## Acceptance criteria

- [ ] `noUncheckedIndexedAccess` enabled — all violations fixed with explicit checks (not type assertions)
- [ ] `exactOptionalPropertyTypes` enabled — all violations fixed
- [ ] `noImplicitReturns` enabled — all violations fixed
- [ ] `noFallthroughCasesInSwitch` enabled — all violations fixed
- [ ] `noImplicitOverride` enabled — all violations fixed
- [ ] Both `noFloatingPromises` Biome overrides removed
- [ ] All floating promise violations fixed with `void` prefix or `.catch()`
- [ ] `apps/web/.claude/CLAUDE.md` has a TypeScript Patterns section
- [ ] `pnpm check-all` passes (typecheck + lint + build)

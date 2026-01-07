---
status: accepted
date: "2026-01-07"
category: technical
domains: [platform]
---

# Migrate from Bun to Node.js + pnpm

## Context and Problem Statement

Zentity uses Bun as both runtime and package manager for the web frontend (`apps/web`) and landing page (`apps/landing`). However, we've encountered significant stability issues with native modules (tfjs-node, bb.js, tfhe) that require Node.js fallbacks. Test execution hangs indefinitely under Bun, forcing us to switch to Node.js for test runs. The Docker images already install Node.js alongside Bun as a workaround. This creates a hybrid runtime environment with increased complexity and maintenance burden.

## Priorities & Constraints

- Production stability is paramount for identity verification workloads
- Native module compatibility (tfjs-node for face detection, bb.js for ZK verification)
- Minimize operational complexity in Docker deployments
- Maintain developer experience for local development
- CI/CD pipeline reliability

## Decision Outcome

Chosen option: **Migrate fully to Node.js + pnpm**

Bun provides marginal benefits (~5-10% faster installs) at the cost of ecosystem immaturity and native module complications. The codebase already relies on Node.js workarounds, and zero Bun-specific APIs are used. pnpm offers comparable install speeds with battle-tested stability.

### Expected Consequences

- **Positive**: Unified runtime eliminates hybrid Bun+Node workarounds
- **Positive**: Stable native module support (tfjs-node postinstall works correctly)
- **Positive**: Tests run reliably without OOM/hanging issues
- **Positive**: Simpler Dockerfile (single runtime, no Node.js fallback needed)
- **Positive**: Better enterprise ecosystem support
- **Negative**: ~100-200ms slower script invocation (negligible)
- **Negative**: Requires `tsx` for running TypeScript scripts (Bun ran `.ts` natively)

## Alternatives Considered

- **Option 1: Full migration to Node.js + pnpm** (chosen)
- **Option 2: Keep hybrid Bun + Node.js** — Maintains status quo with ongoing workaround maintenance
- **Option 3: Wait for Bun maturity** — Unknown timeline, current issues persist

## More Information

- Vitest test hanging issue: [oven-sh/bun#17723](https://github.com/oven-sh/bun/issues/17723)
- High CPU usage: [oven-sh/bun#21654](https://github.com/oven-sh/bun/issues/21654)
- Migration plan: `docs/bun-to-node-migration.md`

## Migration info

Migrate from Bun runtime and package manager to Node.js + pnpm for improved stability with native modules (tfjs-node, bb.js) and elimination of hybrid runtime workarounds.

## Files to Change

| File | Action |
|------|--------|
| `docs/adr/platform/0001-bun-to-node-migration.md` | Create (new ADR) |
| `docs/bun-to-node-migration.md` | Create (this document) |
| `apps/web/package.json` | Update scripts, engines, add tsx |
| `apps/landing/package.json` | Update scripts |
| `apps/web/Dockerfile` | Replace Bun with Node.js + pnpm |
| `.github/workflows/code-quality.yml` | Replace setup-bun with setup-node + pnpm |
| `CLAUDE.md` | Update documentation |
| `apps/web/.claude/CLAUDE.md` | Update ultracite commands |
| `apps/web/bun.lock` | Delete |
| `apps/landing/bun.lock` | Delete (if exists) |

## Step 1: Update `apps/web/package.json`

### Changes

1. Remove `"bun": "1.3.x"` from `engines`
2. Add `"pnpm": "10.x"` to `engines`
3. Update all script commands:

| Script | Before | After |
|--------|--------|-------|
| `setup:coep-assets` | `bun scripts/setup-coep-assets.ts` | `pnpm exec tsx scripts/setup-coep-assets.ts` |
| `dev` | `bun run setup:coep-assets && bun ./node_modules/next/dist/bin/next dev` | `pnpm run setup:coep-assets && next dev` |
| `build` | `bun run setup:coep-assets && bun ./node_modules/next/dist/bin/next build` | `pnpm run setup:coep-assets && next build` |
| `start` | `bun ./node_modules/next/dist/bin/next start` | `next start` |
| `test:e2e:setup` | `bun e2e/automation/build-synpress-cache.ts` | `pnpm exec tsx e2e/automation/build-synpress-cache.ts` |
| `test:e2e` | `bun run test:e2e:setup && bunx playwright test` | `pnpm run test:e2e:setup && pnpm exec playwright test` |
| `test:e2e:ui` | `bun run test:e2e:setup && bunx playwright test --ui` | `pnpm run test:e2e:setup && pnpm exec playwright test --ui` |
| `circuits:profile` | `bun scripts/noir-profile.ts` | `pnpm exec tsx scripts/noir-profile.ts` |
| `circuits:check-versions` | `bun scripts/check-noir-versions.ts` | `pnpm exec tsx scripts/check-noir-versions.ts` |
| `lint-staged` | `bun x ultracite fix` | `pnpm exec ultracite fix` |

1. Add `tsx` to devDependencies: `"tsx": "^4.19.4"`

## Step 2: Update `apps/landing/package.json`

### Changes

| Script | Before | After |
|--------|--------|-------|
| `check-all` | `bun run type-check && bun run lint:check` | `pnpm run type-check && pnpm run lint:check` |
| `fix-all` | `bun run type-check && bun run lint` | `pnpm run type-check && pnpm run lint` |

## Step 3: Update `apps/web/Dockerfile`

### Changes

1. Replace `oven/bun:1-debian` with `node:24-slim` for deps stage
2. Replace `oven/bun:1-slim` with `node:24-slim` for runner stage
3. Install pnpm via corepack
4. Replace `bun install` with `pnpm install`
5. Replace `bun run build` with `pnpm run build`
6. Remove separate `nodejs` install in runner stage (already have Node.js)

### Docker Image Hashes

Use pinned hashes for reproducibility:

```dockerfile
FROM node:24-slim@sha256:b83af04d005d8e3716f542469a28ad2947ba382f6b4a76ddca0827a21446a540 AS deps
```

## Step 4: Update `.github/workflows/code-quality.yml`

### Changes

Replace all occurrences of:

```yaml
- uses: oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76 # v2.0.2
```

With (pinned hashes with version comments):

```yaml
- uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f # v6.1.0
  with:
    node-version: '24'
- uses: pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061 # v4.2.0
  with:
    version: latest
```

Replace all occurrences of:

- `bun install --frozen-lockfile` → `pnpm install --frozen-lockfile`
- `bun run lint:check` → `pnpm run lint:check`
- `bun run type-check` → `pnpm run type-check`
- `bun audit` → `pnpm audit`
- `bunx markdownlint-cli` → `pnpm exec markdownlint-cli`

## Step 5: Delete Bun Lockfiles

Delete:

- `apps/web/bun.lock`
- `apps/landing/bun.lock` (if exists)

After updating package.json files, run `pnpm install` in each directory to generate `pnpm-lock.yaml`.

## Step 6: Update Root `CLAUDE.md`

1. Update "Manual Setup" section:
   - Remove "Bun 1.3+ (runtime + package manager for `apps/web`)"
   - Add "pnpm 10+ (package manager)"

2. Update "Install Dependencies" section to use `pnpm install`

3. Update "Build & Development Commands" section:
   - Change `bun run dev` → `pnpm dev`
   - Change `bun run build` → `pnpm build`
   - Change `bun run lint` → `pnpm lint`
   - Change `bun run test` → `pnpm test`

4. Remove tfjs-node troubleshooting section (pnpm handles postinstall correctly)

## Step 7: Update `apps/web/.claude/CLAUDE.md`

- Update `bun x ultracite fix` → `pnpm exec ultracite fix`
- Update `bun x ultracite check` → `pnpm exec ultracite check`
- Update `bun x ultracite doctor` → `pnpm exec ultracite doctor`

## Verification

1. `pnpm install` completes without errors
2. `pnpm dev` starts dev server
3. `pnpm build` produces production build
4. `pnpm test` runs all tests successfully
5. `pnpm run test:e2e` runs E2E tests
6. Docker build succeeds: `docker build -t zentity-web apps/web`

## Rollback Plan

If issues arise after migration:

1. Revert all changes: `git checkout HEAD~1 -- .`
2. Run `bun install` to restore lockfiles
3. Document specific issue encountered

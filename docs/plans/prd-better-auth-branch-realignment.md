# PRD: Better-Auth Branch Realignment & Patch Elimination

## Problem Statement

Zentity depends on 10 better-auth packages, customized via two mechanisms: **vendored tarballs** (6 packages built from fork branches) and **pnpm patches** (4 packages patched on top of npm `1.5.1-beta.3`). Over time, three categories of drift have accumulated:

1. **Orphan commits on the synthetic combined branch** — `feat/zentity-combined` has 5 commits that exist only on the combined branch, not on any feature branch. The combined branch was designed to be a pure merge of feature branches with zero unique content. These orphan changes are effectively invisible to upstream PRs and may be silently missing from vendored tarballs (the tarballs were packed before 3 of the 5 commits were added).

2. **Zentity-side patches that belong in better-auth** — The `@better-auth/oauth-provider` pnpm patch contains 4 changes (clientId in claims callbacks, redirect_uri relaxation, auth_session passthrough, token exchange schema widening) that are general-purpose oauth-provider improvements, not Zentity-specific hacks. They should be in proper better-auth branches with upstream PRs.

3. **Stale base version** — All branches are based on a local canary that is 61 commits behind `origin/canary`. Two previously-open PRs (#8292 pairwise, #7865 customIdTokenClaims override) have been merged upstream. The npm dependency is pinned to `1.5.1-beta.3` while `1.5.5` is the latest stable release (which already includes our merged PRs). One branch (`feat/pairwise-jwt-access-token-sub`, PR #8410) was self-closed as incorrect.

Additionally, 4 vendor tarballs sit unused in `apps/web/vendor/` (better-auth, core, passkey, telemetry) — leftovers from a prior vendoring approach that was replaced by npm + patches.

The net effect: changes are in the wrong places, the combined branch has diverged from its intended role, tarballs may not reflect the latest source, and the base version is months behind upstream.

## Solution

A three-phase realignment that:

1. **Updates the base** — Pull latest `origin/canary`, update npm dependencies to `v1.5.5`, rebase all feature branches onto the updated canary
2. **Places every change on the right branch** — Cherry-pick orphan commits to their proper feature branches, create new branches for changes that have no home, eliminate the Zentity oauth-provider patch entirely
3. **Rebuilds from scratch** — Delete the old `feat/zentity-combined`, recreate it as a deterministic merge of all feature branches, pack fresh tarballs, regenerate any remaining patches for the new base version

End state: every change lives in exactly one feature branch, the combined branch is a pure merge, Zentity patches are zero or near-zero, and the base version matches the latest npm stable.

## User Stories

1. As a contributor to better-auth, I want each feature branch to contain all and only its own changes, so that upstream PRs are self-contained and reviewable.
2. As a contributor to better-auth, I want feature branches rebased on the latest canary, so that PRs don't have stale merge conflicts and include upstream fixes.
3. As a Zentity developer, I want the synthetic combined branch to be a pure merge of feature branches with zero unique commits, so that I can trust it as a reproducible build artifact.
4. As a Zentity developer, I want the Zentity oauth-provider patch to be empty (or eliminated), so that all better-auth customizations are traceable to upstream branches.
5. As a Zentity developer, I want vendored tarballs to reflect the exact state of their source branches, so that runtime behavior matches the source code I can read and debug.
6. As a Zentity developer, I want npm dependencies updated to the latest stable version, so that Zentity benefits from upstream bugfixes and the patches are smaller.
7. As a Zentity developer, I want unused vendor tarballs removed, so that `apps/web/vendor/` contains only files that are actually referenced.
8. As a Zentity developer, I want the `feat/pairwise-jwt-access-token-sub` branch deleted, so that closed/invalid branches don't cause confusion.
9. As a contributor, I want the CIBA branch to contain all CIBA-related changes (including agent_claims and redirect_uri relaxation), so that the CIBA PR is complete.
10. As a contributor, I want new branches created for FPA (First-Party Apps) and Token Exchange features, so that these capabilities have proper upstream PR paths.
11. As a Zentity developer, I want the `better-auth` and `@better-auth/core` pnpm patches regenerated for `v1.5.5`, so that they only contain changes not yet merged upstream (reducing patch size since pairwise and customIdTokenClaims are now in the base).
12. As a CIBA plugin consumer, I want the plugin to export `deliverPing` (or handle it automatically after `sendNotification`), so that auto-approved ping-mode requests emit notifications without reimplementing the HTTP POST inline.
13. As a HAIP plugin consumer, I want the PAR endpoint to expose the generated `requestId` in the after-hook context, so that after-hooks can update the exact pushed request row instead of using heuristic queries.

## Implementation Decisions

### Phase 1: Update the base

**Update local canary:**

- `git pull origin canary` to bring local canary to `origin/canary` HEAD
- All feature branches will be rebased onto the updated canary using `git rebase`, resolving conflicts as they arise

**Update npm dependencies in Zentity:**

- Bump `better-auth`, `@better-auth/core`, `@better-auth/passkey`, `@better-auth/drizzle-adapter` from `1.5.1-beta.3` to `1.5.5`
- Update the `pnpm.overrides` for `@better-auth/core` to `1.5.5`
- Regenerate `patches/better-auth@1.5.5.patch` and `vendor/@better-auth__core@1.5.5.patch` — these should be significantly smaller since pairwise (#8292) and customIdTokenClaims override (#7865) are already in `1.5.5`
- Regenerate `vendor/@better-auth__passkey@1.5.5.patch` for the new base

### Phase 2: Place every change on the right branch

**Existing branches to update (rebase onto updated canary):**

| Branch | PR | Action |
|--------|-----|--------|
| `fix/oauth-response-format` | #7521 OPEN | Rebase onto canary. No new content. |
| `feat/public-endpoints-infrastructure` | #7524 OPEN | Rebase onto canary. No new content. |
| `feat/passkey-preauth-extensions` | #7154 OPEN | Rebase onto canary. No new content. |
| `feat/two-factor-passwordless-canary` | #7243 OPEN | Rebase onto canary. No new content. |
| `feat/oidc-verifiable-credentials` | No PR yet | Rebase onto canary. Add `clientId` in `customAccessTokenClaims` (currently a Zentity patch). |
| `feat/oidc-haip` | No PR yet | Rebase onto `feat/oidc-verifiable-credentials` (stacked). Expose PAR `requestId` in after-hook context (currently Zentity uses `isNull(resource)` heuristic). |
| `feat/ciba-plugin` | #8485 OPEN | Rebase onto canary. Cherry-pick agent_claims commit. Add `redirect_uri` relaxation (currently a Zentity patch). Export `deliverPing` for auto-approve flows (currently Zentity reimplements ping delivery inline). |

**Branches to delete:**

| Branch | Reason |
|--------|--------|
| `feat/pairwise-jwt-access-token-sub` | PR #8410 self-closed ("wrong assumption"). Base pairwise (#8292) already merged upstream. |

**New branches to create (from updated canary):**

| Branch | Content | Source |
|--------|---------|--------|
| `fix/oauth-provider-par-loopback-dcr` | PAR scope loss fix, loopback port matching (RFC 8252 §7.3), DCR `skip_consent` | Cherry-pick from zentity-combined `d6ab711` |
| `fix/oauth-provider-acr-auth-time-override` | Move `acr`/`auth_time` before `customClaims` spread (follow-up to merged #7865) | Cherry-pick from zentity-combined `4bfa691` |
| `feat/oauth-provider-at-hash` | Pass `accessToken` to `customIdTokenClaims` callback, sequence id_token after access token | Cherry-pick from zentity-combined `7df54d5` |
| `feat/first-party-apps` | `auth_session` passthrough in token response for FPA step-up re-auth | New commit from Zentity patch content |
| `feat/token-exchange` | Token endpoint body schema widening (`subject_token`, `subject_token_type`, `requested_token_type`, `audience`) for RFC 8693 | New commit from Zentity patch content |

**CIBA plugin: export `deliverPing` for auto-approve flows:**

The CIBA plugin's `deliverPing` is currently an internal function called only inside the `/ciba/authorize` endpoint handler. When a `sendNotification` callback auto-approves a request (updating the DB directly), there is no way to trigger ping delivery without reimplementing the HTTP POST. The plugin should export `deliverPing(endpoint, token, authReqId)` so consumers can call it after programmatic approval. Zentity currently carries a standalone `deliverCibaPing` function in `auth.ts` as a workaround — this can be removed once the plugin exports it. See cross-app auth hardening finding #7.

**HAIP plugin: expose PAR `requestId` in after-hook context:**

The HAIP plugin's PAR endpoint generates a `requestId` (returned as `request_uri` in the response) but does not attach it to the after-hook context. Consumers that need to update the pushed request row in an after-hook (e.g., to persist a `resource` parameter) must use heuristic queries like `clientId AND resource IS NULL ORDER BY createdAt DESC`. This has a race condition under concurrent PAR requests from the same client. The fix: attach `requestId` to the hook context (e.g., `ctx.context.__parRequestId`) so `afterParPersistResource` can `WHERE request_id = ?`. Zentity currently uses the `isNull` fallback — this can be replaced once the plugin exposes the ID. See cross-app auth hardening finding #8.

**Zentity oauth-provider patch elimination:**

After placing all 4 patch changes into proper branches (clientId → oidc-vc, redirect_uri → ciba, auth_session → first-party-apps, token exchange → token-exchange), the `patches/@better-auth__oauth-provider.patch` file should be deleted. All changes will come from the vendored tarball built from the combined branch.

### Phase 3: Rebuild from scratch

**Recreate the synthetic combined branch:**

1. Delete the existing `feat/zentity-combined` branch
2. Create a new `feat/zentity-combined` from updated canary
3. Merge each feature branch in dependency order:
   - `fix/oauth-response-format`
   - `feat/public-endpoints-infrastructure`
   - `feat/oidc-verifiable-credentials` (contains the two above + OID4VC)
   - `feat/oidc-haip` (stacked on oidc-vc)
   - `feat/passkey-preauth-extensions`
   - `feat/two-factor-passwordless-canary`
   - `feat/ciba-plugin`
   - `fix/oauth-provider-par-loopback-dcr`
   - `fix/oauth-provider-acr-auth-time-override`
   - `feat/oauth-provider-at-hash`
   - `feat/first-party-apps`
   - `feat/token-exchange`
4. Verify: `git log canary..feat/zentity-combined --no-merges` should show only commits from feature branches, zero unique commits

**Pack fresh tarballs:**

Build each package from the combined branch and replace the vendored tarballs in Zentity:

- `@better-auth/oauth-provider`
- `@better-auth/ciba`
- `@better-auth/haip`
- `@better-auth/oidc4ida`
- `@better-auth/oidc4vci`
- `@better-auth/oidc4vp`

**Clean up Zentity vendor directory:**

Delete unused tarballs:

- `better-auth-1.5.1-beta.3.tgz`
- `better-auth-core-1.5.1-beta.3.tgz`
- `better-auth-passkey-1.5.1-beta.3.tgz`
- `better-auth-telemetry-1.5.1-beta.3.tgz`

Delete eliminated patch:

- `patches/@better-auth__oauth-provider.patch`

### Branch dependency map (final state)

```text
canary (updated to origin/canary)
 ├── fix/oauth-response-format                    [PR #7521]
 ├── feat/public-endpoints-infrastructure          [PR #7524]
 ├── feat/oidc-verifiable-credentials              [includes above two + OID4VC + clientId claims]
 │    └── feat/oidc-haip                           [stacked: HAIP plugin + PAR requestId in hook ctx]
 ├── feat/passkey-preauth-extensions               [PR #7154]
 ├── feat/two-factor-passwordless-canary            [PR #7243]
 ├── feat/ciba-plugin                              [PR #8485 + agent_claims + redirect_uri + export deliverPing]
 ├── fix/oauth-provider-par-loopback-dcr           [NEW]
 ├── fix/oauth-provider-acr-auth-time-override     [NEW]
 ├── feat/oauth-provider-at-hash                   [NEW]
 ├── feat/first-party-apps                         [NEW]
 └── feat/token-exchange                           [NEW]

feat/zentity-combined = pure merge of ALL above (zero unique commits)
```

### Conflict resolution strategy

Use `git rebase` onto updated canary for each branch, resolving conflicts manually. Key areas likely to conflict:

- `packages/oauth-provider/src/token.ts` — upstream now includes pairwise (#8292) and customIdTokenClaims fix (#7865). Our acr/auth_time and at_hash changes touch the same function.
- `packages/passkey/src/routes.ts` — upstream added error codes (#5831). Our PRF extensions touch the same routes.
- `packages/better-auth/src/api/` — upstream refactored with `better-call` v2 (#8021). Our publicEndpoints and response format changes touch the same dispatch logic.
- `packages/better-auth/src/plugins/two-factor/` — upstream wired `twoFactorTable` (#8443). Our passwordless changes touch the same plugin.

## Testing Decisions

Good tests for this PRD verify that **the rebased code produces the same runtime behavior as before** — this is a structural reorganization, not a feature change.

**What to verify after rebasing each branch:**

- The better-auth monorepo builds successfully (`pnpm build` in the affected packages)
- Existing tests in the better-auth repo pass for the modified packages
- The compiled output (dist/) is functionally equivalent to the pre-rebase version

**What to verify after updating Zentity:**

- `pnpm install` succeeds with new versions and patches
- `pnpm typecheck` passes (type compatibility with v1.5.5)
- `pnpm test:unit` passes (no runtime regressions)
- `pnpm test:integration` passes
- `pnpm build` succeeds

**Prior art:**

- `apps/web/src/lib/auth/__tests__/` — auth integration tests that exercise oauth-provider, CIBA, passkey flows
- `apps/mcp/__tests__/` — MCP tool tests that exercise the vendored packages
- `apps/web/e2e/` — Playwright E2E tests for full flows

## Out of Scope

- **`@daveyplate/better-auth-ui` patch** — The 1.2MB UI patch for two-factor passwordless is a third-party package concern. It should be handled separately, potentially by submitting upstream to daveyplate.
- **New upstream PRs** — This PRD creates the branches but does not cover submitting new PRs for the 5 new branches (par-loopback-dcr, acr-override, at-hash, first-party-apps, token-exchange). PR submission is a follow-up.
- **Updating open PRs** — The existing open PRs (#7521, #7524, #7154, #7243, #8485) will need force-pushes after rebase, but the PR descriptions and review status are not in scope.
- **oidc-verifiable-credentials and oidc-haip PR creation** — These branches have no upstream PR yet. Creating those PRs is separate work.
- **Zentity application code changes** — This PRD only restructures the better-auth dependency layer. No changes to Zentity's own source code (auth.ts, routes, components) are in scope, except updating `package.json` versions and patch references.

## Further Notes

- **Execution order matters**: Phase 1 (update base) must complete before Phase 2 (branch placement), which must complete before Phase 3 (rebuild combined). Within Phase 2, independent branches can be rebased in parallel, but stacked branches (oidc-vc → oidc-haip) must be sequential.
- **Force-push implications**: Rebasing branches with open PRs (#7521, #7524, #7154, #7243, #8485) requires force-pushing to the fork remote. The PRs will update automatically but lose review approvals if any.
- **Version alignment**: After this work, Zentity should use `better-auth@1.5.5` from npm (with a smaller patch) and vendored tarballs built from branches based on a canary that includes `v1.5.5` content. This minimizes the diff between npm packages and vendored packages.
- **Lockfile on combined branch**: The `pnpm-lock.yaml` changes from adding new packages (haip, oidc4*, ciba) are an artifact of the combined branch. Each individual branch only modifies its own package — the lockfile aggregation happens naturally when merging into combined.
- **`feat/oidc-verifiable-credentials` includes `fix/oauth-response-format` and `feat/public-endpoints-infrastructure`**: These three branches have a content overlap — the oidc-vc branch contains equivalent commits to the other two. After rebase, verify the merge into combined doesn't create duplicate changes. If the oidc-vc branch is rebased to include the other two as ancestors (rather than cherry-picks), the merge will be clean.
- **Zentity workarounds to remove after plugin changes land**: Once `feat/ciba-plugin` exports `deliverPing`, remove `deliverCibaPing` from `apps/web/src/lib/auth/auth.ts` and import from the plugin. Once `feat/oidc-haip` exposes PAR `requestId` in the hook context, update `afterParPersistResource` in `auth.ts` to use `WHERE request_id = ?` instead of the `isNull(resource)` heuristic. Both workarounds were added in the cross-app auth hardening pass (see `docs/plans/prd-cross-app-auth-hardening.md`).

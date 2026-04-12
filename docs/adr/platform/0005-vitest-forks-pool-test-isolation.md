---
status: "accepted"
date: "2026-04-12"
category: "platform"
domains: [platform, audit]
---

# Process-per-file Vitest isolation (`forks` pool)

## Context and Problem Statement

The `apps/web` unit suite grew to 115+ test files with an ESM graph spanning better-auth, drizzle, @noble/post-quantum, noir.js, ethers, jsdom, and @testing-library/react. Under `pool: "vmThreads"` with `maxWorkers: 1`, the single worker accumulated VM contexts indefinitely (Vitest's docs state: *"Importing ES modules caches them indefinitely which introduces memory leaks if you have a lot of contexts"*). Around file 80-100 the worker silently ran out of heap; the default reporter swallowed the crash, producing exit code 0 with no `Test Files / Tests / Duration` summary. Pre-commit and CI therefore reported green on runs that had lost tests or failed deterministically. Repeat runs produced non-reproducible counts (820/20, 808/16, 856/21, 794/22 passed/failed without config changes).

The decision is which Vitest isolation boundary gives reliable, reproducible test signal at this codebase size, and what trade-offs we accept for it.

## Priorities & Constraints

* Reliability of the CI/pre-commit signal is non-negotiable; silent exit-0 with lost tests is the worst possible failure mode.
* Test runtime matters but is secondary; the suite runs locally on every commit and in CI.
* The shared SQLite test DB cannot tolerate parallel writers without redesign.
* Vitest 4 flattened the pool options API: `test.poolOptions.forks.execArgv` became `test.execArgv`, `singleFork` became `maxWorkers: 1, isolate: false`. The old nested form is silently ignored (no type error, no deprecation warning at runtime).
* The codebase has ~115 unit test files plus integration tests; isolation overhead per file is amortized across a known-bounded set.

## Decision Outcome

Chosen option: **`pool: "forks"` with `isolate: true`, `fileParallelism: false`, `maxWorkers: 1`, `execArgv: ["--max-old-space-size=2048"]`**.

Every test file runs in a fresh Node child process. The process exits between files, returning all heap, module caches, and native resources to the OS. `fileParallelism: false` keeps writes to the shared SQLite DB serial. `execArgv` caps per-file heap at 2 GB; a test file needing more is a flag for investigation, not a limit to raise.

We also switched the default reporter configuration to `["default", "hanging-process"]` so stuck teardowns surface instead of timing out silently.

### Expected Consequences

* Full suite runtime went from ~20s (flaky, lost tests, silent crashes) to ~35s (deterministic, all 929 tests accounted for across 117 files, exit code reflects reality).
* Fork isolation is a bug-surfacing mechanism: latent bugs that shared-memory pools hid now fail loudly. Example: `use-fhevm-sdk-provider.test.tsx` passed fresh object literals to a hook whose `useCallback` deps included them, producing an infinite re-render loop. `vmThreads` killed it via test timeout and reported "lost"; `forks` ran it to 4 GB OOM with a full stack trace pointing at the file. Both outcomes reflect the same underlying bug; only the latter is actionable.
* Redundant mock-restore calls (`vi.restoreAllMocks()` inside a global `afterEach` alongside `restoreMocks: true` in config) were removed. Vitest 4 docs clarify these are no-ops on `vi.fn()` automocks; only `vi.spyOn` spies are affected.
* Future test-infrastructure work MUST be validated across three consecutive full-suite runs, not one. Single-run greens proved nothing under the old setup.
* Adding a test that requires >2 GB heap should prompt investigation (leaking subscriptions, infinite loops, unmocked heavy deps) before raising the limit.

## Alternatives Considered

* **`pool: "vmThreads"` (previous default)**: fastest cold start, but leaks module caches across VM contexts in a shared worker thread. Rejected because it produces silent exit-0 on worker crash at our codebase size. This is the failure mode that motivated the ADR.
* **`pool: "threads"` with `maxWorkers: 1`**: reuses one worker thread; memory accumulates less aggressively than `vmThreads` but still accumulates across files in the same V8 isolate. `workerIdleMemoryLimit` can recycle workers by heap usage, but the threshold tuning is fragile and still trails the actual OOM point. Rejected.
* **`pool: "forks"` with `singleFork: true` (Vitest 4: `isolate: false, maxWorkers: 1`)**: one child process for all files, faster than per-file forks. Rejected for the same accumulation reason as `threads`; the process-reuse amortizes startup but reintroduces cross-file memory pollution.
* **`pool: "forks"` with `fileParallelism: true`**: per-file forks running concurrently. Rejected because the shared SQLite test DB serializes writes via `busy_timeout`, and observed runs produced `SQLITE_BUSY` and flaky integration failures under concurrency.
* **Move all DB-touching tests to integration config**: would reduce per-file memory pressure in the unit config. Rejected as a separate concern; the flat pool-options migration was the blocking issue.

## More Information

Related configs: `apps/web/vitest.unit.config.mts`, `apps/web/vitest.config.mts`, `apps/web/vitest.setup.mts`.

Vitest 4 migration: pool rework flattened `test.poolOptions.{pool}.*` to top-level `test.*`. The nested form is silently ignored at runtime, which is how the OOM symptom was originally misattributed to "forks pool immediately OOMs": the `execArgv` limit was never applied.

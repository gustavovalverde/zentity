/**
 * Vitest setup file — runs before each test file.
 *
 * Responsibilities:
 * 1. Set default environment variables
 * 2. Configure React act() environment
 * 3. Register cross-cutting module mocks (auth stub, server-only, next/headers)
 * 4. Register global afterEach hooks Vitest can't express via config
 *
 * Mock lifecycle: `clearMocks` + `restoreMocks` in vitest.unit.config.mts
 * already run `vi.clearAllMocks()` / `vi.restoreAllMocks()` before each test.
 * Per Vitest 4.x docs, `restoreAllMocks` only affects `vi.spyOn` spies — it
 * does NOT touch `vi.fn()` implementations inside `vi.mock()` factories — so
 * the config-driven path is safe for factory-declared mocks.
 */
import { afterEach, vi } from "vitest";

process.env.TURSO_DATABASE_URL ||= "file:./.data/test.db";
process.env.BETTER_AUTH_SECRET ||= "test-secret-32-chars-minimum........";

// Some tests exercise real OPAQUE flows; the placeholder value fails hard
// inside @serenity-kit/opaque, so regenerate once per worker.
if (
  !process.env.OPAQUE_SERVER_SETUP ||
  process.env.OPAQUE_SERVER_SETUP === "test-opaque-server-setup-placeholder"
) {
  const { ready, server: opaqueServer } = await import("@serenity-kit/opaque");
  await ready;
  process.env.OPAQUE_SERVER_SETUP = opaqueServer.createSetup();
}
process.env.DEDUP_HMAC_SECRET ||= "test-dedup-hmac-secret-minimum-32-chars";
process.env.PAIRWISE_SECRET ||= "test-pairwise-secret-minimum-32-chars";
process.env.CLAIM_SIGNING_SECRET ||= "test-claim-signing-secret-min-32-chars";
process.env.CIPHERTEXT_HMAC_SECRET ||= "test-ciphertext-hmac-secret-min-32ch";
process.env.DRIZZLE_LOG ||= "false";

// React act() environment must be set on every realm where React runs.
// Setting on globalThis covers both Node and jsdom environments.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// `@/lib/auth` has no index.ts, so this only activates for tests that import
// the path directly. Tests that need richer auth mocking mock "@/lib/auth/auth"
// per-file.
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
    })
  ),
}));

afterEach(() => {
  // Restore real timers when a test leaves fake timers installed. Vitest's
  // config-driven mock hygiene doesn't touch the timer flag.
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});

const unhandledRejectionHandler = (reason: unknown) => {
  console.error("Unhandled Rejection in test:", reason);
};

if (process.listenerCount("unhandledRejection") === 0) {
  process.on("unhandledRejection", unhandledRejectionHandler);
}

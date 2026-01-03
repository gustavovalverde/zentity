/**
 * Vitest setup file - runs before each test file
 *
 * Responsibilities:
 * 1. Set default environment variables
 * 2. Configure React act() environment
 * 3. Set up global mocks (auth, Next.js)
 * 4. Register global cleanup hooks
 */
import { afterAll, afterEach, vi } from "vitest";

// === Environment Variables ===
// Use file-based test database (schema pushed by globalSetup)
process.env.TURSO_DATABASE_URL ||= "file:./.data/test.db";
process.env.BETTER_AUTH_SECRET ||= "test-secret-32-chars-minimum........";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

// Disable logging in tests unless explicitly enabled
process.env.DRIZZLE_LOG ||= "false";

// === React act() Environment ===
// Prevents act() warnings in jsdom tests
const actEnv = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnv.IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window !== "undefined") {
  (
    window as typeof window & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}
if (typeof global !== "undefined") {
  (
    global as typeof global & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
}

// === Global Mocks ===

// Mock Better Auth - prevents real auth calls in tests
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

// Mock Next.js server-only module (no-op in tests)
vi.mock("server-only", () => ({}));

// Mock Next.js headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
    })
  ),
}));

// === Global Cleanup Hooks ===

afterEach(() => {
  // Restore all mocks to their original state
  vi.restoreAllMocks();

  // Restore real timers if fake timers were used
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});

afterAll(async () => {
  // Close database connection to prevent leaks
  try {
    const { dbClient } = await import("@/lib/db/connection");
    dbClient.close();
  } catch {
    // Connection may not have been initialized in this test file
  }

  vi.restoreAllMocks();
});

// === Unhandled Rejection Handler ===
// Log unhandled rejections for debugging (now that we removed dangerouslyIgnoreUnhandledErrors)
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection in test:", reason);
});

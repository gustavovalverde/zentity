/**
 * Vitest setup file - runs before each test file
 */
import { vi } from "vitest";

process.env.DATABASE_PATH ||= ":memory:";
process.env.BETTER_AUTH_SECRET ||= "test-secret-32-chars-minimum........";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

// Ensure React act() is enabled in tests (prevents act warnings in jsdom)
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

// Mock Better Auth
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

// Mock Next.js headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
    }),
  ),
}));

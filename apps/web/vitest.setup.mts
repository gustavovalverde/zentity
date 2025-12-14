/**
 * Vitest setup file - runs before each test file
 */
import { vi } from "vitest";

process.env.DATABASE_PATH ||= ":memory:";
process.env.BETTER_AUTH_SECRET ||= "test-secret-32-chars-minimum........";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

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

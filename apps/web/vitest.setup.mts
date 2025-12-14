/**
 * Vitest setup file - runs before each test file
 */
import { vi } from "vitest";

// Mock better-sqlite3 for database tests
vi.mock("better-sqlite3", () => {
  const mockStmt = {
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
  };

  const mockDb = {
    prepare: vi.fn(() => mockStmt),
    exec: vi.fn(),
    close: vi.fn(),
  };

  const DatabaseMock = vi.fn(function DatabaseMock() {
    return mockDb;
  });

  return {
    __esModule: true,
    default: DatabaseMock,
  };
});

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

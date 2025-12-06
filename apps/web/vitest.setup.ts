import { vi } from "vitest";

// Mock better-sqlite3 for unit tests
vi.mock("better-sqlite3", () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  };
  return {
    default: vi.fn(() => ({
      prepare: vi.fn(() => mockStmt),
      exec: vi.fn(),
    })),
  };
});

// Mock next/headers for API route tests
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Map()),
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

// Mock auth for API route tests
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

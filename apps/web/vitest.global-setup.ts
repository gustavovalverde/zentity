/**
 * Vitest global setup - runs once before all test files
 *
 * Initializes the test database schema using drizzle-kit push.
 * This ensures all tests have access to properly initialized tables.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const TEST_DB_PATH = "./.data/test.db";
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

export function setup(): void {
  // Ensure .data directory exists
  const dir = dirname(TEST_DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Remove old test database to start fresh
  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  // Push schema to test database
  console.log("Initializing test database schema...");
  try {
    execSync("bunx drizzle-kit push --force", {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TURSO_DATABASE_URL: TEST_DB_URL,
        TURSO_AUTH_TOKEN: undefined,
      },
      // Stream output to console instead of buffering (prevents hangs)
      stdio: "inherit",
      // Timeout after 60 seconds to prevent indefinite hanging
      timeout: 60_000,
    });
    console.log("Test database schema initialized.");
  } catch (error) {
    console.error("Failed to initialize test database:", error);
    throw error;
  }
}

export function teardown(): void {
  // Clean up test database after all tests
  if (existsSync(TEST_DB_PATH)) {
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {
      // Best effort cleanup
    }
  }
}

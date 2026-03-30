/**
 * Vitest global setup — runs once before all test files.
 *
 * Initialises the test database schema using drizzle-kit push.
 * The DB file is deleted before push to guarantee a clean slate:
 * every suite run starts from an empty schema with no stale rows.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const TEST_DB_PATH = "./.data/test.db";
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

export function setup(): void {
  const dir = dirname(TEST_DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(TEST_DB_PATH)) {
    unlinkSync(TEST_DB_PATH);
  }

  console.log("Initializing test database schema...");
  try {
    execFileSync("npx", ["drizzle-kit", "push", "--force"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TURSO_DATABASE_URL: TEST_DB_URL,
        TURSO_AUTH_TOKEN: undefined,
      },
      stdio: "inherit",
      timeout: 60_000,
    });
    console.log("Test database schema initialized.");
  } catch (error) {
    console.error("Failed to initialize test database:", error);
    throw error;
  }
}

export function teardown(): void {
  // DB file is left for debugging. Deleted on next setup().
}

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type APIResponse, type FullConfig, request } from "@playwright/test";

const currentDir =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = path.join(currentDir, ".auth", "user.json");
const AUTH_SEED_PATH = path.join(currentDir, ".auth", "seed.json");
const E2E_DB_PATH =
  process.env.E2E_DATABASE_PATH ?? path.join(currentDir, ".data", "e2e.db");
const DEFAULT_APP_DB_PATH =
  process.env.DATABASE_PATH ?? path.join(currentDir, "..", "dev.db");
const INIT_DB_SQL_PATH = path.join(currentDir, "..", "scripts", "init-db.sql");

type ApiContext = Awaited<ReturnType<typeof request.newContext>>;

async function postWithRetries(
  api: ApiContext,
  url: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  let lastText = "";

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await api.post(url, { data });
    if (response.ok()) return response;

    lastText = await response.text().catch(() => "");
    if (response.status() !== 429) return response;

    const delayMs = 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Failed request ${url}: ${lastText}`);
}

async function waitForServer(api: ApiContext) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await api.get("/api/health");
    if (response.ok()) return;
    const delayMs = 500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("E2E global setup failed: /api/health not ready");
}

type AuthSeed = {
  email: string;
  password: string;
  name: string;
};

function getOrCreateSeed(): AuthSeed {
  if (fs.existsSync(AUTH_SEED_PATH)) {
    const seed = JSON.parse(
      fs.readFileSync(AUTH_SEED_PATH, "utf8"),
    ) as AuthSeed;
    if (seed?.email && seed?.password) return seed;
  }

  const email =
    process.env.E2E_EMAIL ?? `e2e-${Date.now().toString(16)}@example.com`;
  const password =
    process.env.E2E_PASSWORD ?? crypto.randomBytes(24).toString("base64url");
  const name = process.env.E2E_NAME ?? "e2e";
  const seed = { email, password, name };

  fs.mkdirSync(path.dirname(AUTH_SEED_PATH), { recursive: true });
  fs.writeFileSync(AUTH_SEED_PATH, JSON.stringify(seed, null, 2));
  return seed;
}

function ensureE2EDatabaseInitialized() {
  if (!fs.existsSync(INIT_DB_SQL_PATH)) {
    throw new Error(`Missing DB init script at ${INIT_DB_SQL_PATH}`);
  }

  fs.mkdirSync(path.dirname(E2E_DB_PATH), { recursive: true });

  const sql = fs.readFileSync(INIT_DB_SQL_PATH, "utf8");
  const result = spawnSync("sqlite3", [E2E_DB_PATH], {
    input: sql,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `E2E DB init failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

function ensureDatabaseInitialized(dbPath: string) {
  if (!fs.existsSync(INIT_DB_SQL_PATH)) {
    throw new Error(`Missing DB init script at ${INIT_DB_SQL_PATH}`);
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sql = fs.readFileSync(INIT_DB_SQL_PATH, "utf8");
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `DB init failed for ${dbPath}: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

function runSql(dbPath: string, sql: string) {
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `E2E DB query failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
  return result.stdout.trim();
}

function seedVerifiedIdentity(dbPath: string, email: string) {
  const userId = runSql(
    dbPath,
    `SELECT id FROM "user" WHERE email = '${email.replace(/'/g, "''")}';`,
  );

  if (!userId) {
    throw new Error(`E2E seed user not found for ${email}`);
  }

  const now = new Date().toISOString();
  const proofId = crypto.randomUUID();
  const ageProofId = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString("hex");
  const docHash = `doc_${crypto.randomUUID().replace(/-/g, "")}`;
  const nameCommitment = `name_${crypto.randomUUID().replace(/-/g, "")}`;

  const identitySql = `
    INSERT OR REPLACE INTO identity_proofs (
      id,
      user_id,
      document_hash,
      name_commitment,
      user_salt,
      document_type,
      country_verified,
      is_document_verified,
      is_liveness_passed,
      is_face_matched,
      verification_method,
      verified_at,
      confidence_score,
      created_at,
      updated_at,
      birth_year_offset
    ) VALUES (
      '${proofId}',
      '${userId}',
      '${docHash}',
      '${nameCommitment}',
      '${salt}',
      'passport',
      'USA',
      1,
      1,
      1,
      'e2e',
      '${now}',
      0.99,
      '${now}',
      '${now}',
      90
    );
  `;

  const ageProofSql = `
    INSERT OR REPLACE INTO age_proofs (
      id,
      user_id,
      proof,
      public_signals,
      is_over_18,
      created_at
    ) VALUES (
      '${ageProofId}',
      '${userId}',
      'mock-proof',
      'mock-signals',
      1,
      '${now}'
    );
  `;

  runSql(dbPath, identitySql);
  runSql(dbPath, ageProofSql);
}

function resetBlockchainState(dbPath: string) {
  runSql(dbPath, "DELETE FROM blockchain_attestations;");
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    "http://localhost:3000";

  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  const { email, password, name } = getOrCreateSeed();

  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: baseURL,
      "Content-Type": "application/json",
    },
  });

  await waitForServer(api);
  ensureE2EDatabaseInitialized();
  resetBlockchainState(E2E_DB_PATH);

  if (DEFAULT_APP_DB_PATH !== E2E_DB_PATH) {
    ensureDatabaseInitialized(DEFAULT_APP_DB_PATH);
    resetBlockchainState(DEFAULT_APP_DB_PATH);
  }

  const signUpResponse = await postWithRetries(api, "/api/auth/sign-up/email", {
    email,
    password,
    name,
  });

  if (!signUpResponse.ok()) {
    const bodyText = await signUpResponse.text().catch(() => "");
    const isAlreadyRegistered =
      signUpResponse.status() === 409 ||
      bodyText.includes("already exists") ||
      bodyText.includes("ALREADY_EXISTS") ||
      bodyText.includes("USER_ALREADY_EXISTS");

    if (!isAlreadyRegistered) {
      throw new Error(
        `E2E global setup failed to sign up: ${bodyText || "unknown error"}`,
      );
    }
  }

  const signInResponse = await postWithRetries(api, "/api/auth/sign-in/email", {
    email,
    password,
  });

  if (!signInResponse.ok()) {
    throw new Error(
      `E2E global setup failed to sign in: ${await signInResponse.text()}`,
    );
  }

  seedVerifiedIdentity(E2E_DB_PATH, email);
  if (DEFAULT_APP_DB_PATH !== E2E_DB_PATH) {
    seedVerifiedIdentity(DEFAULT_APP_DB_PATH, email);
  }

  await api.storageState({ path: AUTH_STATE_PATH });
  await api.dispose();
}

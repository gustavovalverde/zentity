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

  applySchemaMigrations(E2E_DB_PATH);
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

  applySchemaMigrations(dbPath);
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

const SCHEMA_MIGRATIONS = [
  { table: "zk_proofs", column: "proof_payload", type: "TEXT" },
  { table: "zk_proofs", column: "is_over_18", type: "INTEGER" },
  { table: "zk_proofs", column: "generation_time_ms", type: "INTEGER" },
  { table: "zk_proofs", column: "circuit_type", type: "TEXT" },
  { table: "zk_proofs", column: "noir_version", type: "TEXT" },
  { table: "zk_proofs", column: "circuit_hash", type: "TEXT" },
  { table: "zk_proofs", column: "bb_version", type: "TEXT" },
  {
    table: "encrypted_attributes",
    column: "encryption_time_ms",
    type: "INTEGER",
  },
];

function applySchemaMigrations(dbPath: string) {
  for (const migration of SCHEMA_MIGRATIONS) {
    ensureColumn(dbPath, migration.table, migration.column, migration.type);
  }
}

function ensureColumn(
  dbPath: string,
  table: string,
  column: string,
  type: string,
) {
  const result = runSql(
    dbPath,
    `SELECT COUNT(*) as count FROM pragma_table_info('${table}') WHERE name = '${column}';`,
  );
  const count = Number.parseInt(result, 10);
  if (Number.isNaN(count)) {
    throw new Error(
      `Failed to inspect schema for ${table}.${column}: ${result || "unknown"}`,
    );
  }
  if (count > 0) return;
  runSql(dbPath, `ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
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
  const documentId = crypto.randomUUID();
  const bundleId = userId;
  const salt = crypto.randomBytes(16).toString("hex");
  const docHash = `doc_${crypto.randomUUID().replace(/-/g, "")}`;
  const nameCommitment = `name_${crypto.randomUUID().replace(/-/g, "")}`;
  const policyVersion = "poc-v1";

  const identityBundleSql = `
    INSERT OR REPLACE INTO identity_bundles (
      user_id,
      status,
      policy_version,
      issuer_id,
      created_at,
      updated_at
    ) VALUES (
      '${bundleId}',
      'verified',
      '${policyVersion}',
      'zentity-kyc',
      '${now}',
      '${now}'
    );
  `;

  const identityDocumentSql = `
    INSERT OR REPLACE INTO identity_documents (
      id,
      user_id,
      document_type,
      issuer_country,
      document_hash,
      name_commitment,
      user_salt,
      birth_year_offset,
      verified_at,
      confidence_score,
      status,
      created_at,
      updated_at
    ) VALUES (
      '${documentId}',
      '${userId}',
      'passport',
      'USA',
      '${docHash}',
      '${nameCommitment}',
      '${salt}',
      90,
      '${now}',
      0.99,
      'verified',
      '${now}',
      '${now}'
    );
  `;

  const signedClaimsSql = `
    INSERT OR REPLACE INTO signed_claims (
      id,
      user_id,
      document_id,
      claim_type,
      claim_payload,
      signature,
      issued_at,
      created_at
    ) VALUES
      (
        '${crypto.randomUUID()}',
        '${userId}',
        '${documentId}',
        'liveness_score',
        '{"type":"liveness_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"antispoofScore":0.98,"liveScore":0.97}}',
        'e2e-signature',
        '${now}',
        '${now}'
      ),
      (
        '${crypto.randomUUID()}',
        '${userId}',
        '${documentId}',
        'face_match_score',
        '{"type":"face_match_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"confidence":0.93}}',
        'e2e-signature',
        '${now}',
        '${now}'
      );
  `;

  const zkProofSql = `
    INSERT OR REPLACE INTO zk_proofs (
      id,
      user_id,
      document_id,
      proof_type,
      proof_hash,
      proof_payload,
      public_inputs,
      is_over_18,
      generation_time_ms,
      nonce,
      policy_version,
      circuit_type,
      noir_version,
      circuit_hash,
      bb_version,
      verified,
      created_at
    ) VALUES (
      '${crypto.randomUUID()}',
      '${userId}',
      '${documentId}',
      'age_verification',
      'proof_${crypto.randomUUID().replace(/-/g, "")}',
      'mock-proof',
      '["${new Date().getFullYear()}","18","${crypto.randomUUID()}","1"]',
      1,
      1240,
      '${crypto.randomUUID()}',
      '${policyVersion}',
      'age_verification',
      null,
      null,
      null,
      1,
      '${now}'
    );
  `;

  const encryptedAttributesSql = `
    INSERT OR REPLACE INTO encrypted_attributes (
      id,
      user_id,
      source,
      attribute_type,
      ciphertext,
      key_id,
      encryption_time_ms,
      created_at
    ) VALUES (
      '${crypto.randomUUID()}',
      '${userId}',
      'e2e_seed',
      'birth_year_offset',
      'mock-ciphertext',
      'default',
      42,
      '${now}'
    );
  `;

  runSql(dbPath, identityBundleSql);
  runSql(dbPath, identityDocumentSql);
  runSql(dbPath, signedClaimsSql);
  runSql(dbPath, zkProofSql);
  runSql(dbPath, encryptedAttributesSql);
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

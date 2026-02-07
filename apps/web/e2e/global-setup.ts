import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { type APIResponse, type FullConfig, request } from "@playwright/test";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = join(currentDir, ".auth", "user.json");
const AUTH_SEED_PATH = join(currentDir, ".auth", "seed.json");
const E2E_DB_PATH =
  process.env.E2E_DATABASE_PATH ?? join(currentDir, ".data", "e2e.db");
const DEFAULT_APP_DB_PATH = join(currentDir, "..", ".data", "dev.db");
const SELECT_QUERY_REGEX = /^select\s/i;
const IS_OIDC_ONLY = process.env.E2E_OIDC_ONLY === "true";

type ApiContext = Awaited<ReturnType<typeof request.newContext>>;

async function postWithRetries(
  api: ApiContext,
  url: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  let lastText = "";

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await api.post(url, { data });
    if (response.ok()) {
      return response;
    }

    lastText = await response.text().catch(() => "");
    if (response.status() !== 429) {
      return response;
    }

    const delayMs = 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Failed request ${url}: ${lastText}`);
}

async function waitForServer(api: ApiContext) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await api.get("/api/health");
    if (response.ok()) {
      return;
    }
    const delayMs = 500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("E2E global setup failed: /api/health not ready");
}

interface AuthSeed {
  email: string;
  password: string;
  name: string;
}

function getOrCreateSeed(): AuthSeed {
  if (existsSync(AUTH_SEED_PATH)) {
    const seed = JSON.parse(readFileSync(AUTH_SEED_PATH, "utf8")) as AuthSeed;
    if (seed?.email && seed?.password) {
      return seed;
    }
  }

  const email =
    process.env.E2E_EMAIL ?? `e2e-${Date.now().toString(16)}@example.com`;
  const password =
    process.env.E2E_PASSWORD ?? randomBytes(24).toString("base64url");
  const name = process.env.E2E_NAME ?? "e2e";
  const seed = { email, password, name };

  mkdirSync(dirname(AUTH_SEED_PATH), { recursive: true });
  writeFileSync(AUTH_SEED_PATH, JSON.stringify(seed, null, 2));
  return seed;
}

function toFileUrl(value: string) {
  if (value.startsWith("file:") || value.startsWith("libsql:")) {
    return value;
  }
  return `file:${value}`;
}

function getFilePathFromUrl(dbUrl: string): string | null {
  if (!dbUrl.startsWith("file:")) {
    return null;
  }
  const path = dbUrl.slice("file:".length);
  if (path === ":memory:" || path === "::memory:") {
    return null;
  }
  return path;
}

const E2E_DB_URL = process.env.E2E_TURSO_DATABASE_URL ?? toFileUrl(E2E_DB_PATH);
const DEFAULT_APP_DB_URL =
  process.env.TURSO_DATABASE_URL ?? toFileUrl(DEFAULT_APP_DB_PATH);

function runDrizzlePush(dbUrl: string) {
  const result = spawnSync("pnpm", ["run", "db:push"], {
    cwd: join(currentDir, ".."),
    env: {
      ...process.env,
      TURSO_DATABASE_URL: dbUrl,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `db:push failed for ${dbUrl}: ${result.stderr || result.stdout || "unknown error"}`
    );
  }
}

function ensureE2EDatabaseInitialized() {
  const filePath = getFilePathFromUrl(E2E_DB_URL);
  if (filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  runDrizzlePush(E2E_DB_URL);
}

function ensureDatabaseInitialized(dbUrl: string) {
  const filePath = getFilePathFromUrl(dbUrl);
  if (filePath) {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  runDrizzlePush(dbUrl);
}

async function runSql(dbUrl: string, sql: string) {
  const client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const trimmed = sql.trim();
    if (!trimmed) {
      return "";
    }
    const isSelect = SELECT_QUERY_REGEX.test(trimmed);
    const result = await client.execute(trimmed);
    if (!isSelect) {
      return "";
    }
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return "";
    }
    const firstKey = Object.keys(row)[0];
    const value = firstKey ? row[firstKey] : undefined;
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    const primitive = value as string | number | boolean | bigint;
    return String(primitive);
  } catch (error) {
    throw new Error(
      `E2E DB query failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    try {
      client.close();
    } catch {
      // Best-effort cleanup.
    }
  }
}

// Schema is managed via drizzle-kit push; no manual schema migrations here.

async function ensureUserExists(
  dbUrl: string,
  email: string,
  name: string
): Promise<string> {
  // Check if user exists
  let userId = await runSql(
    dbUrl,
    `SELECT id FROM "user" WHERE email = '${email.replaceAll("'", "''")}';`
  );

  if (!userId) {
    // Create user directly in database if not found
    const now = new Date().toISOString();
    userId = randomUUID();
    await runSql(
      dbUrl,
      `INSERT INTO "user" (id, email, name, emailVerified, createdAt, updatedAt)
       VALUES ('${userId}', '${email.replaceAll("'", "''")}', '${name.replaceAll("'", "''")}', 1, '${now}', '${now}');`
    );
    console.log(
      `[global-setup] Created E2E user directly in database: ${email}`
    );
  }

  return userId;
}

async function seedVerifiedIdentity(
  dbUrl: string,
  email: string,
  name: string
) {
  const userId = await ensureUserExists(dbUrl, email, name);
  if (!userId) {
    throw new Error(
      `E2E seed user not found and could not be created for ${email}`
    );
  }

  const now = new Date().toISOString();
  const documentId = randomUUID();
  const bundleId = userId;
  const docHash = `doc_${randomUUID().replaceAll("-", "")}`;
  const nameCommitment = `name_${randomUUID().replaceAll("-", "")}`;
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
        '${randomUUID()}',
        '${userId}',
        '${documentId}',
        'liveness_score',
        '{"type":"liveness_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"antispoofScore":0.98,"liveScore":0.97}}',
        'e2e-signature',
        '${now}',
        '${now}'
      ),
      (
        '${randomUUID()}',
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
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        '${documentId}',
        'age_verification',
        'proof_${randomUUID().replaceAll("-", "")}',
        'mock-proof',
        '["${new Date().getFullYear()}","18","${randomUUID()}","1"]',
        1,
        1240,
        '${randomUUID()}',
        '${policyVersion}',
        'age_verification',
        null,
        null,
        null,
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${documentId}',
        'face_match',
        'proof_${randomUUID().replaceAll("-", "")}',
        'mock-proof',
        '["0.95","${randomUUID()}"]',
        null,
        980,
        '${randomUUID()}',
        '${policyVersion}',
        'face_match',
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
      '${randomUUID()}',
      '${userId}',
      'e2e_seed',
      'birth_year_offset',
      'mock-ciphertext',
      'default',
      42,
      '${now}'
    );
  `;

  await runSql(dbUrl, identityBundleSql);
  await runSql(dbUrl, identityDocumentSql);
  await runSql(dbUrl, signedClaimsSql);
  await runSql(dbUrl, zkProofSql);
  await runSql(dbUrl, encryptedAttributesSql);
}

async function resetTwoFactor(dbUrl: string, email: string) {
  const userId = await runSql(
    dbUrl,
    `SELECT id FROM "user" WHERE email = '${email.replaceAll("'", "''")}';`
  );
  if (!userId) {
    return;
  }
  await runSql(dbUrl, `DELETE FROM two_factor WHERE user_id = '${userId}';`);
  await runSql(
    dbUrl,
    `UPDATE "user" SET two_factor_enabled = 0 WHERE id = '${userId}';`
  );
}

async function resetRecoveryState(dbUrl: string, email: string) {
  const userId = await runSql(
    dbUrl,
    `SELECT id FROM "user" WHERE email = '${email.replaceAll("'", "''")}';`
  );
  if (!userId) {
    return;
  }
  const configId = await runSql(
    dbUrl,
    `SELECT id FROM recovery_configs WHERE user_id = '${userId}';`
  );
  if (configId) {
    await runSql(
      dbUrl,
      `DELETE FROM recovery_guardian_approvals WHERE challenge_id IN (SELECT id FROM recovery_challenges WHERE recovery_config_id = '${configId}');`
    );
    await runSql(
      dbUrl,
      `DELETE FROM recovery_challenges WHERE recovery_config_id = '${configId}';`
    );
    await runSql(
      dbUrl,
      `DELETE FROM recovery_guardians WHERE recovery_config_id = '${configId}';`
    );
    await runSql(
      dbUrl,
      `DELETE FROM recovery_configs WHERE id = '${configId}';`
    );
  }
  await runSql(
    dbUrl,
    `DELETE FROM recovery_secret_wrappers WHERE user_id = '${userId}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM recovery_identifiers WHERE user_id = '${userId}';`
  );
}

async function resetBlockchainState(dbUrl: string) {
  await runSql(dbUrl, "DELETE FROM blockchain_attestations;");
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";

  console.log("[global-setup] Starting E2E global setup");
  console.log("[global-setup] E2E_DB_URL:", E2E_DB_URL);
  console.log("[global-setup] DEFAULT_APP_DB_URL:", DEFAULT_APP_DB_URL);

  mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true });

  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: baseURL,
      "Content-Type": "application/json",
    },
  });

  await waitForServer(api);
  ensureE2EDatabaseInitialized();
  await resetBlockchainState(E2E_DB_URL);

  if (DEFAULT_APP_DB_URL !== E2E_DB_URL) {
    ensureDatabaseInitialized(DEFAULT_APP_DB_URL);
    await resetBlockchainState(DEFAULT_APP_DB_URL);
  }

  if (IS_OIDC_ONLY) {
    const signInResponse = await postWithRetries(
      api,
      "/api/auth/sign-in/anonymous",
      {}
    );

    if (!signInResponse.ok()) {
      throw new Error(
        `E2E global setup failed to sign in anonymously: ${await signInResponse.text()}`
      );
    }

    await api.storageState({ path: AUTH_STATE_PATH });
    await api.dispose();
    return;
  }

  const { email, password, name } = getOrCreateSeed();

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
        `E2E global setup failed to sign up: ${bodyText || "unknown error"}`
      );
    }
  }

  await resetTwoFactor(E2E_DB_URL, email);
  await resetRecoveryState(E2E_DB_URL, email);
  if (DEFAULT_APP_DB_URL !== E2E_DB_URL) {
    await resetTwoFactor(DEFAULT_APP_DB_URL, email);
    await resetRecoveryState(DEFAULT_APP_DB_URL, email);
  }

  const signInResponse = await postWithRetries(api, "/api/auth/sign-in/email", {
    email,
    password,
  });

  if (!signInResponse.ok()) {
    throw new Error(
      `E2E global setup failed to sign in: ${await signInResponse.text()}`
    );
  }

  await seedVerifiedIdentity(E2E_DB_URL, email, name);
  if (DEFAULT_APP_DB_URL !== E2E_DB_URL) {
    await seedVerifiedIdentity(DEFAULT_APP_DB_URL, email, name);
  }

  await api.storageState({ path: AUTH_STATE_PATH });
  await api.dispose();
}

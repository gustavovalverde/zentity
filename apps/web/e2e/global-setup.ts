import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { encode } from "@msgpack/msgpack";
import { type APIResponse, request } from "@playwright/test";
import {
  client as opaqueProtocolClient,
  ready as opaqueProtocolReady,
} from "@serenity-kit/opaque";

import { createE2EOpaqueSecret } from "./opaque-secret-seed";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = join(currentDir, ".auth", "user.json");
const AUTH_SEED_PATH = join(currentDir, ".auth", "seed.json");
const CURRENT_POLICY_VERSION = "compliance-policy-2025-12-28";
const E2E_DB_PATH =
  process.env.E2E_DATABASE_PATH ?? join(currentDir, ".data", "e2e.db");
const DEFAULT_APP_DB_PATH = join(currentDir, "..", ".data", "dev.db");
const SELECT_QUERY_REGEX = /^select\s/i;
const WHITESPACE_REGEX = /\s+/;
const IS_OIDC_ONLY = process.env.E2E_OIDC_ONLY === "true";
type IdentitySeedVariant = "incomplete" | "verified_with_profile";
const identitySeedVariant: IdentitySeedVariant =
  process.env.E2E_IDENTITY_SEED_VARIANT === "verified_with_profile"
    ? "verified_with_profile"
    : "incomplete";

type ApiContext = Awaited<ReturnType<typeof request.newContext>>;

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

function normalizeBase64(base64: string): string {
  const normalized = base64.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = normalized.length % 4;
  if (padLength === 0) {
    return normalized;
  }
  return `${normalized}${"=".repeat(4 - padLength)}`;
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  return base64ToBytes(normalizeBase64(base64Url));
}

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
    const response = await api.get("/api/status/health");
    if (response.ok()) {
      return;
    }
    const delayMs = 500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("E2E global setup failed: /api/status/health not ready");
}

interface AuthSeed {
  email: string;
  name: string;
  password: string;
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
  const result = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
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
    ...(process.env.TURSO_AUTH_TOKEN === undefined
      ? {}
      : { authToken: process.env.TURSO_AUTH_TOKEN }),
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

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function clearSeededIdentityState(dbUrl: string, userId: string) {
  await runSql(
    dbUrl,
    `DELETE FROM verification_checks WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM proof_artifacts WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM zk_challenges WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM proof_sessions WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM signed_claims WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM encrypted_attributes WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM secret_wrappers
     WHERE user_id = '${escapeSqlString(userId)}'
       AND secret_id IN (
         SELECT id FROM encrypted_secrets
         WHERE user_id = '${escapeSqlString(userId)}'
           AND secret_type IN ('profile', 'fhe_keys')
       );`
  );
  await runSql(
    dbUrl,
    `DELETE FROM encrypted_secrets
     WHERE user_id = '${escapeSqlString(userId)}'
       AND secret_type IN ('profile', 'fhe_keys');`
  );
  await runSql(
    dbUrl,
    `DELETE FROM identity_bundles WHERE user_id = '${escapeSqlString(userId)}';`
  );
  await runSql(
    dbUrl,
    `DELETE FROM identity_verifications WHERE user_id = '${escapeSqlString(userId)}';`
  );
}

async function deriveOpaqueExportKey(
  api: ApiContext,
  password: string
): Promise<Uint8Array> {
  await opaqueProtocolReady;

  const { clientLoginState, startLoginRequest } =
    opaqueProtocolClient.startLogin({ password });

  const challengeResponse = await api.post(
    "/api/auth/password/opaque/verify/challenge",
    {
      data: { loginRequest: startLoginRequest },
    }
  );

  if (!challengeResponse.ok()) {
    throw new Error(
      `OPAQUE verify challenge failed: ${await challengeResponse.text()}`
    );
  }

  const challengeBody = (await challengeResponse.json()) as {
    challenge?: string;
    state?: string;
  };

  if (!(challengeBody.challenge && challengeBody.state)) {
    throw new Error("OPAQUE verify challenge response was invalid.");
  }

  const verifyResult = opaqueProtocolClient.finishLogin({
    clientLoginState,
    loginResponse: challengeBody.challenge,
    password,
  });
  if (!verifyResult) {
    throw new Error("OPAQUE login completion did not produce a client result.");
  }

  const completeResponse = await api.post(
    "/api/auth/password/opaque/verify/complete",
    {
      data: {
        loginResult: verifyResult.finishLoginRequest,
        encryptedServerState: challengeBody.state,
      },
    }
  );

  if (!completeResponse.ok()) {
    throw new Error(
      `OPAQUE verify completion failed: ${await completeResponse.text()}`
    );
  }

  return base64UrlToBytes(verifyResult.exportKey);
}

async function ensureOpaquePasswordRegistration(
  api: ApiContext,
  password: string
): Promise<void> {
  await opaqueProtocolReady;

  const { clientRegistrationState, registrationRequest } =
    opaqueProtocolClient.startRegistration({ password });

  const challengeResponse = await api.post(
    "/api/auth/password/opaque/registration/challenge",
    {
      data: { registrationRequest },
    }
  );

  if (!challengeResponse.ok()) {
    throw new Error(
      `OPAQUE registration challenge failed: ${await challengeResponse.text()}`
    );
  }

  const challengeBody = (await challengeResponse.json()) as {
    challenge?: string;
  };

  if (!challengeBody.challenge) {
    throw new Error("OPAQUE registration challenge response was invalid.");
  }

  const registrationResult = opaqueProtocolClient.finishRegistration({
    clientRegistrationState,
    registrationResponse: challengeBody.challenge,
    password,
  });

  if (!registrationResult) {
    throw new Error(
      "OPAQUE registration completion did not produce a client result."
    );
  }

  const completeResponse = await api.post(
    "/api/auth/password/opaque/registration/complete",
    {
      data: {
        registrationRecord: registrationResult.registrationRecord,
      },
    }
  );

  if (!completeResponse.ok()) {
    throw new Error(
      `OPAQUE registration completion failed: ${await completeResponse.text()}`
    );
  }
}

function buildProfileSecretPayload(name: string) {
  const parts = name.trim().split(WHITESPACE_REGEX).filter(Boolean);
  const firstName = parts[0] ?? "E2E";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "User";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  return {
    addressCountryCode: "US",
    birthYear: 1990,
    dateOfBirth: "1990-01-01",
    documentHash: `doc_${randomUUID().replaceAll("-", "")}`,
    documentNumber: "E2E123456",
    documentOrigin: "USA",
    documentType: "passport",
    expiryDateInt: 20_300_101,
    firstName,
    fullName,
    lastName,
    nationality: "United States",
    nationalityCode: "USA",
    residentialAddress: "123 Market Street, San Francisco, CA 94105, USA",
    updatedAt: new Date().toISOString(),
    userSalt: `salt_${randomUUID().replaceAll("-", "")}`,
  };
}

function buildFheKeySecretPayload(createdAt: string) {
  return encode({
    clientKey: randomBytes(32),
    publicKey: randomBytes(32),
    serverKey: randomBytes(32),
    createdAt,
  });
}

async function seedOpaqueSecret(
  api: ApiContext,
  dbUrl: string,
  userId: string,
  password: string,
  params: {
    envelopeFormat: "json" | "msgpack";
    metadata?: Record<string, unknown>;
    plaintext: Uint8Array;
    secretId?: string;
    secretType: "fhe_keys" | "profile";
  }
) {
  const exportKey = await deriveOpaqueExportKey(api, password);
  const secretId = params.secretId ?? randomUUID();
  const { envelope, wrapper } = await createE2EOpaqueSecret({
    secretId,
    userId,
    exportKey,
    secretType: params.secretType,
    plaintext: params.plaintext,
    envelopeFormat: params.envelopeFormat,
  });

  const blobResponse = await api.post("/api/secrets/blob", {
    data: Buffer.from(envelope.encryptedBlob),
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Secret-Id": secretId,
      "X-Secret-Type": params.secretType,
    },
  });

  if (!blobResponse.ok()) {
    throw new Error(
      `${params.secretType} blob upload failed: ${await blobResponse.text()}`
    );
  }

  const blobBody = (await blobResponse.json()) as { blobRef?: string };
  if (!blobBody.blobRef) {
    throw new Error(`${params.secretType} blob upload response was invalid.`);
  }

  const blobHash = sha256Hex(envelope.encryptedBlob);
  const metadata = escapeSqlString(
    JSON.stringify({
      envelopeFormat: envelope.envelopeFormat,
      ...(params.metadata ?? {}),
    })
  );

  await runSql(
    dbUrl,
    `INSERT INTO encrypted_secrets (
      id,
      user_id,
      secret_type,
      encrypted_blob,
      blob_ref,
      blob_hash,
      blob_size,
      metadata
    ) VALUES (
      '${escapeSqlString(secretId)}',
      '${escapeSqlString(userId)}',
      '${escapeSqlString(params.secretType)}',
      '',
      '${escapeSqlString(blobBody.blobRef)}',
      '${blobHash}',
      ${envelope.encryptedBlob.byteLength},
      '${metadata}'
    );`
  );

  await runSql(
    dbUrl,
    `INSERT INTO secret_wrappers (
      id,
      secret_id,
      user_id,
      credential_id,
      wrapped_dek,
      prf_salt,
      kek_source,
      base_commitment
    ) VALUES (
      '${randomUUID()}',
      '${escapeSqlString(secretId)}',
      '${escapeSqlString(userId)}',
      '${escapeSqlString(wrapper.credentialId)}',
      '${escapeSqlString(wrapper.wrappedDek)}',
      NULL,
      '${escapeSqlString(wrapper.kekSource)}',
      NULL
    );`
  );

  return secretId;
}

async function seedProfileSecret(
  api: ApiContext,
  dbUrl: string,
  userId: string,
  password: string,
  name: string
) {
  const payload = buildProfileSecretPayload(name);
  await seedOpaqueSecret(api, dbUrl, userId, password, {
    envelopeFormat: "json",
    plaintext: new TextEncoder().encode(JSON.stringify(payload)),
    secretType: "profile",
  });
}

async function seedFheKeySecret(
  api: ApiContext,
  dbUrl: string,
  userId: string,
  password: string,
  keyId: string
) {
  return await seedOpaqueSecret(api, dbUrl, userId, password, {
    envelopeFormat: "msgpack",
    metadata: { keyId },
    plaintext: buildFheKeySecretPayload(new Date().toISOString()),
    secretId: keyId,
    secretType: "fhe_keys",
  });
}

async function seedIncompleteVerificationState(dbUrl: string, userId: string) {
  const now = new Date().toISOString();
  const verificationId = randomUUID();
  const bundleId = userId;
  const docHash = `doc_${randomUUID().replaceAll("-", "")}`;
  const nameCommitment = `name_${randomUUID().replaceAll("-", "")}`;
  const policyVersion = "poc-v1";

  const identityBundleSql = `
    INSERT OR REPLACE INTO identity_bundles (
      user_id,
      effective_verification_id,
      validity_status,
      policy_version,
      issuer_id,
      created_at,
      updated_at
    ) VALUES (
      '${bundleId}',
      '${verificationId}',
      'verified',
      '${policyVersion}',
      'zentity-kyc',
      '${now}',
      '${now}'
    );
  `;

  const identityVerificationSql = `
    INSERT OR REPLACE INTO identity_verifications (
      id,
      user_id,
      method,
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
      '${verificationId}',
      '${userId}',
      'ocr',
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
      verification_id,
      claim_type,
      claim_payload,
      signature,
      issued_at,
      created_at
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'liveness_score',
        '{"type":"liveness_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"antispoofScore":0.98,"liveScore":0.97}}',
        'e2e-signature',
        '${now}',
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'face_match_score',
        '{"type":"face_match_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"confidence":0.93}}',
        'e2e-signature',
        '${now}',
        '${now}'
      );
  `;

  const proofArtifactsSql = `
    INSERT OR REPLACE INTO proof_artifacts (
      id,
      user_id,
      verification_id,
      proof_system,
      proof_type,
      proof_hash,
      proof_payload,
      public_inputs,
      generation_time_ms,
      nonce,
      policy_version,
      metadata,
      verified,
      created_at
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'age_verification',
        'proof_${randomUUID().replaceAll("-", "")}',
        'mock-proof',
        '["${new Date().getFullYear()}","18","${randomUUID()}","1"]',
        1240,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"age_verification","isOver18":true}',
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'face_match',
        'proof_${randomUUID().replaceAll("-", "")}',
        'mock-proof',
        '["0.95","${randomUUID()}"]',
        980,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"face_match"}',
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

  // Seed verification_checks to produce the "incomplete verification" state
  // (identity checks passed; ZK proofs still missing for nationality/identity_binding)
  // check_type values match CHECK_TYPE_TO_COMPLIANCE_KEY in read-model.ts
  const verificationChecksSql = `
    INSERT OR REPLACE INTO verification_checks (
      id, user_id, verification_id, check_type, passed, source, created_at, updated_at
    ) VALUES
      ('${randomUUID()}', '${userId}', '${verificationId}', 'document', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'liveness', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'face_match', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'age', 1, 'e2e_seed', '${now}', '${now}');
  `;

  await runSql(dbUrl, identityVerificationSql);
  await runSql(dbUrl, identityBundleSql);
  await runSql(dbUrl, signedClaimsSql);
  await runSql(dbUrl, proofArtifactsSql);
  await runSql(dbUrl, encryptedAttributesSql);
  await runSql(dbUrl, verificationChecksSql);
}

async function seedVerifiedWithProfileState(
  api: ApiContext,
  dbUrl: string,
  userId: string,
  password: string,
  name: string
) {
  const now = new Date().toISOString();
  const nowEpochMs = Date.now();
  const proofSessionId = randomUUID();
  const verificationId = randomUUID();
  const fheKeyId = `fhe_${randomUUID().replaceAll("-", "")}`;
  const dedupKey = `dedup_${randomUUID().replaceAll("-", "")}`;
  const docHash = `doc_${randomUUID().replaceAll("-", "")}`;
  const nameCommitment = `name_${randomUUID().replaceAll("-", "")}`;
  const nationalityCommitment = `nat_${randomUUID().replaceAll("-", "")}`;
  const policyVersion = CURRENT_POLICY_VERSION;

  const identityBundleSql = `
    INSERT OR REPLACE INTO identity_bundles (
      user_id,
      effective_verification_id,
      validity_status,
      fhe_key_id,
      fhe_status,
      policy_version,
      issuer_id,
      created_at,
      updated_at
    ) VALUES (
      '${userId}',
      '${verificationId}',
      'verified',
      '${fheKeyId}',
      'complete',
      '${policyVersion}',
      'zentity-attestation',
      '${now}',
      '${now}'
    );
  `;

  const identityVerificationSql = `
    INSERT OR REPLACE INTO identity_verifications (
      id,
      user_id,
      method,
      document_type,
      issuer_country,
      document_hash,
      dedup_key,
      name_commitment,
      nationality_commitment,
      verified_at,
      confidence_score,
      status,
      created_at,
      updated_at
    ) VALUES (
      '${verificationId}',
      '${userId}',
      'ocr',
      'passport',
      'USA',
      '${docHash}',
      '${dedupKey}',
      '${nameCommitment}',
      '${nationalityCommitment}',
      '${now}',
      0.99,
      'verified',
      '${now}',
      '${now}'
    );
  `;

  const proofSessionSql = `
    INSERT OR REPLACE INTO proof_sessions (
      id,
      user_id,
      verification_id,
      msg_sender,
      audience,
      policy_version,
      created_at,
      expires_at,
      closed_at
    ) VALUES (
      '${proofSessionId}',
      '${userId}',
      '${verificationId}',
      'did:key:z6MkfE2ESeedRuntime',
      'zentity://e2e-seed',
      '${policyVersion}',
      ${nowEpochMs},
      ${nowEpochMs + 300_000},
      NULL
    );
  `;

  const signedClaimsSql = `
    INSERT OR REPLACE INTO signed_claims (
      id,
      user_id,
      verification_id,
      claim_type,
      claim_payload,
      signature,
      issued_at,
      created_at
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'ocr_result',
        '{"type":"ocr_result","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"documentType":"passport","issuerCountry":"USA"}}',
        'e2e-signature',
        '${now}',
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'liveness_score',
        '{"type":"liveness_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"antispoofScore":0.98,"liveScore":0.97}}',
        'e2e-signature',
        '${now}',
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'face_match_score',
        '{"type":"face_match_score","userId":"${userId}","issuedAt":"${now}","version":1,"data":{"passed":true,"confidence":0.93}}',
        'e2e-signature',
        '${now}',
        '${now}'
      );
  `;

  const proofArtifactsSql = `
    INSERT OR REPLACE INTO proof_artifacts (
      id,
      user_id,
      verification_id,
      proof_system,
      proof_type,
      proof_hash,
      proof_session_id,
      proof_payload,
      public_inputs,
      generation_time_ms,
      nonce,
      policy_version,
      metadata,
      verified,
      created_at
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'age_verification',
        'proof_${randomUUID().replaceAll("-", "")}',
        '${proofSessionId}',
        'mock-proof',
        '["1990","18","${randomUUID()}","1"]',
        1240,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"age_verification","isOver18":true}',
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'doc_validity',
        'proof_${randomUUID().replaceAll("-", "")}',
        '${proofSessionId}',
        'mock-proof',
        '["20300101","${randomUUID()}"]',
        1180,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"doc_validity"}',
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'nationality_membership',
        'proof_${randomUUID().replaceAll("-", "")}',
        '${proofSessionId}',
        'mock-proof',
        '["USA","${randomUUID()}"]',
        1120,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"nationality_membership"}',
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'face_match',
        'proof_${randomUUID().replaceAll("-", "")}',
        '${proofSessionId}',
        'mock-proof',
        '["0.95","${randomUUID()}"]',
        980,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"face_match"}',
        1,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        '${verificationId}',
        'noir_ultrahonk',
        'identity_binding',
        'proof_${randomUUID().replaceAll("-", "")}',
        '${proofSessionId}',
        'mock-proof',
        '["binding","${randomUUID()}"]',
        1010,
        '${randomUUID()}',
        '${policyVersion}',
        '{"circuitType":"identity_binding"}',
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
    ) VALUES
      (
        '${randomUUID()}',
        '${userId}',
        'e2e_seed',
        'birth_year_offset',
        'mock-ciphertext',
        'default',
        42,
        '${now}'
      ),
      (
        '${randomUUID()}',
        '${userId}',
        'e2e_seed',
        'liveness_score',
        'mock-ciphertext',
        'default',
        42,
        '${now}'
      );
  `;

  const verificationChecksSql = `
    INSERT OR REPLACE INTO verification_checks (
      id, user_id, verification_id, check_type, passed, source, created_at, updated_at
    ) VALUES
      ('${randomUUID()}', '${userId}', '${verificationId}', 'document', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'liveness', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'face_match', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'age', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'nationality', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'identity_binding', 1, 'e2e_seed', '${now}', '${now}'),
      ('${randomUUID()}', '${userId}', '${verificationId}', 'sybil_resistant', 1, 'e2e_seed', '${now}', '${now}');
  `;

  await runSql(dbUrl, identityVerificationSql);
  await runSql(dbUrl, identityBundleSql);
  await runSql(dbUrl, proofSessionSql);
  await runSql(dbUrl, signedClaimsSql);
  await runSql(dbUrl, proofArtifactsSql);
  await runSql(dbUrl, encryptedAttributesSql);
  await runSql(dbUrl, verificationChecksSql);
  await seedFheKeySecret(api, dbUrl, userId, password, fheKeyId);
  await seedProfileSecret(api, dbUrl, userId, password, name);
}

async function seedIdentityState(params: {
  api: ApiContext;
  dbUrl: string;
  email: string;
  name: string;
  password: string;
  variant: IdentitySeedVariant;
}) {
  const userId = await ensureUserExists(
    params.dbUrl,
    params.email,
    params.name
  );
  if (!userId) {
    throw new Error(
      `E2E seed user not found and could not be created for ${params.email}`
    );
  }

  await clearSeededIdentityState(params.dbUrl, userId);

  if (params.variant === "verified_with_profile") {
    await seedVerifiedWithProfileState(
      params.api,
      params.dbUrl,
      userId,
      params.password,
      params.name
    );
    return;
  }

  await seedIncompleteVerificationState(params.dbUrl, userId);
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

interface GlobalSetupProjectConfig {
  use?: {
    baseURL?: string;
  };
}

interface GlobalSetupConfig {
  projects: GlobalSetupProjectConfig[];
}

export default async function globalSetup(config: GlobalSetupConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";

  console.log("[global-setup] Starting E2E global setup");
  console.log("[global-setup] E2E_DB_URL:", E2E_DB_URL);
  console.log("[global-setup] DEFAULT_APP_DB_URL:", DEFAULT_APP_DB_URL);
  console.log("[global-setup] identitySeedVariant:", identitySeedVariant);

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

  await ensureOpaquePasswordRegistration(api, password);

  await seedIdentityState({
    api,
    dbUrl: E2E_DB_URL,
    email,
    name,
    password,
    variant: identitySeedVariant,
  });
  if (DEFAULT_APP_DB_URL !== E2E_DB_URL) {
    await seedIdentityState({
      api,
      dbUrl: DEFAULT_APP_DB_URL,
      email,
      name,
      password,
      variant: identitySeedVariant,
    });
  }

  await api.storageState({ path: AUTH_STATE_PATH });
  await api.dispose();
}

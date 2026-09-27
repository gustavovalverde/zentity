import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { encode } from "@msgpack/msgpack";
import { type APIRequestContext, type Page, request } from "@playwright/test";

import { createE2EVaultSecret } from "../vault-secret-seed";
import {
  deriveOpaqueExportKey,
  ensureOpaquePasswordRegistration,
} from "./opaque-account";

async function expectOk(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  label: string
) {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${await response.text()}`);
  }
}

async function markEmailVerified(email: string) {
  const url =
    process.env.E2E_TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("E2E database URL is not configured.");
  }
  const client = createClient({ url });
  try {
    await client.execute({
      sql: 'UPDATE "user" SET emailVerified = 1 WHERE email = ?',
      args: [email],
    });
  } finally {
    client.close();
  }
}

async function storeVaultSecret(
  api: APIRequestContext,
  params: Parameters<typeof createE2EVaultSecret>[0] & {
    metadata?: Record<string, unknown>;
  }
): Promise<Uint8Array> {
  const { dek, envelope, wrapper } = await createE2EVaultSecret(params);

  await expectOk(
    await api.post("/api/secrets/blob", {
      data: Buffer.from(envelope.encryptedBlob),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Secret-Id": params.secretId,
        "X-Secret-Type": String(params.secretType),
      },
    }),
    `${params.secretType} blob upload`
  );

  await expectOk(
    await api.post("/api/trpc/secrets.storeSecret", {
      data: {
        secretId: params.secretId,
        secretType: params.secretType,
        blobRef: createHash("sha256").update(params.secretId).digest("hex"),
        blobHash: createHash("sha256")
          .update(envelope.encryptedBlob)
          .digest("hex"),
        blobSize: envelope.encryptedBlob.byteLength,
        wrappedDek: wrapper.wrappedDek,
        credentialId: wrapper.credentialId,
        kekSource: wrapper.kekSource,
        metadata: {
          envelopeFormat: envelope.envelopeFormat,
          ...params.metadata,
        },
      },
    }),
    `${params.secretType} store`
  );

  return dek;
}

/**
 * Create a verified-email user who signs in with an OPAQUE password and whose
 * vault (FHE key root plus a profile naming `firstName`) is wrapped for that
 * password. Leaves the page's browser context signed in.
 */
export async function createPasswordVaultUser(
  page: Page,
  params: { firstName: string }
): Promise<{ email: string; password: string }> {
  const baseURL = new URL(
    process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3100"
  ).origin;
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, "Content-Type": "application/json" },
  });
  const email = `vault-${randomUUID()}@example.com`;
  const password = `Vault-${randomUUID()}`;

  await expectOk(
    await api.post("/api/auth/sign-up/email", {
      data: { email, password, name: params.firstName },
    }),
    "Sign-up"
  );
  await markEmailVerified(email);
  await expectOk(
    await api.post("/api/auth/sign-in/email", {
      data: { email, password },
    }),
    "Sign-in"
  );
  await ensureOpaquePasswordRegistration(api, password);
  const exportKey = await deriveOpaqueExportKey(api, password);

  const session = (await (await api.get("/api/auth/get-session")).json()) as {
    user?: { id?: string };
  };
  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Seeded user has no session.");
  }

  const vaultKey = await storeVaultSecret(api, {
    secretId: randomUUID(),
    secretType: "fhe_keys",
    userId,
    envelopeFormat: "msgpack",
    plaintext: encode({
      clientKey: new Uint8Array(32),
      publicKey: new Uint8Array(32),
      serverKey: new Uint8Array(32),
      createdAt: new Date().toISOString(),
    }),
    wrapWith: { type: "opaque", exportKey },
  });

  await storeVaultSecret(api, {
    secretId: randomUUID(),
    secretType: "profile",
    userId,
    envelopeFormat: "json",
    plaintext: new TextEncoder().encode(
      JSON.stringify({
        firstName: params.firstName,
        updatedAt: new Date().toISOString(),
      })
    ),
    wrapWith: { type: "vault", vaultKey },
  });

  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  return { email, password };
}

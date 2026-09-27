import type { Session } from "@/lib/auth/auth-config";
import type { EnrollmentCredential } from "@/lib/privacy/secrets/catalog";

import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/connection";
import { detachVaultCredential } from "@/lib/db/queries/privacy";
import { accounts } from "@/lib/db/schema/auth";
import { identityBundles } from "@/lib/db/schema/identity";
import {
  credentialBindingCommitments,
  encryptedSecrets,
} from "@/lib/db/schema/privacy";
import { generateRecoveryKey } from "@/lib/privacy/credentials/recovery-key";
import { secretsRouter } from "@/lib/trpc/routers/secrets";
import {
  createTestSession,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";

const state = vi.hoisted(() => ({
  userId: "",
  sessionId: "",
  blobs: new Map<string, Uint8Array>(),
}));

function caller() {
  return secretsRouter.createCaller({
    authContext: null,
    flowId: null,
    flowIdSource: "none",
    req: new Request("http://localhost/api/trpc"),
    requestId: "test-request-id",
    resHeaders: new Headers(),
    session: {
      user: { id: state.userId, email: "user@example.com" },
      session: { id: state.sessionId },
    } as unknown as Session,
  });
}

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    secrets: {
      access: { query: () => caller().access() },
      getSecretBundle: {
        query: (
          input: Parameters<ReturnType<typeof caller>["getSecretBundle"]>[0]
        ) => caller().getSecretBundle(input),
      },
      storeSecret: {
        mutate: (
          input: Parameters<ReturnType<typeof caller>["storeSecret"]>[0]
        ) => caller().storeSecret(input),
      },
      addWrapper: {
        mutate: (
          input: Parameters<ReturnType<typeof caller>["addWrapper"]>[0]
        ) => caller().addWrapper(input),
      },
      removeCredential: {
        mutate: (
          input: Parameters<ReturnType<typeof caller>["removeCredential"]>[0]
        ) => caller().removeCredential(input),
      },
      resetVault: { mutate: () => caller().resetVault() },
    },
  },
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: { user: { id: state.userId } } }),
  },
}));

vi.mock("@/lib/privacy/secrets/storage", () => ({
  uploadSecretBlob: (params: { secretId: string; payload: Uint8Array }) => {
    state.blobs.set(params.secretId, params.payload);
    return Promise.resolve({
      blobRef: crypto
        .createHash("sha256")
        .update(params.secretId)
        .digest("hex"),
      blobHash: crypto
        .createHash("sha256")
        .update(params.payload)
        .digest("hex"),
      blobSize: params.payload.byteLength,
    });
  },
  downloadSecretBlob: (secretId: string) => {
    const blob = state.blobs.get(secretId);
    return blob
      ? Promise.resolve(blob)
      : Promise.reject(new Error("Encrypted secret blob is missing."));
  },
}));

const {
  addVaultCredential,
  loadSecretWithCredential,
  removeVaultCredential,
  storeSecretWithCredential,
  unlockVaultKey,
  verifyVaultCredential,
} = await import("@/lib/privacy/secrets/vault");

const PROFILE = new TextEncoder().encode(
  JSON.stringify({ firstName: "Ada", updatedAt: "2026-01-01T00:00:00Z" })
);

function passkeyMaterial() {
  return {
    type: "passkey" as const,
    credentialId: crypto.randomUUID(),
    prfOutput: new Uint8Array(crypto.randomBytes(32)),
    prfSalt: new Uint8Array(crypto.randomBytes(32)),
  };
}

function opaqueMaterial() {
  return {
    type: "opaque" as const,
    exportKey: new Uint8Array(crypto.randomBytes(64)),
  };
}

async function createVault(credential: EnrollmentCredential) {
  await storeSecretWithCredential({
    secretType: "fhe_keys",
    plaintext: new Uint8Array(crypto.randomBytes(64)),
    credential,
    envelopeFormat: "msgpack",
  });
  await storeSecretWithCredential({
    secretType: "profile",
    plaintext: PROFILE,
    credential,
    envelopeFormat: "json",
  });
}

async function unlockOrThrow(material: Parameters<typeof unlockVaultKey>[0]) {
  const vaultKey = await unlockVaultKey(material);
  if (!vaultKey) {
    throw new Error("Expected a vault");
  }
  return vaultKey;
}

describe("vault recovery", () => {
  beforeEach(async () => {
    await resetDatabase();
    state.blobs.clear();
    state.userId = await createTestUser();
    state.sessionId = (await createTestSession(state.userId)).sessionId;
  });

  it("opens every secret, including ones stored later, with a recovery key", async () => {
    const lostPasskey = passkeyMaterial();
    await storeSecretWithCredential({
      secretType: "fhe_keys",
      plaintext: new Uint8Array(crypto.randomBytes(64)),
      credential: {
        type: "passkey",
        context: { userId: state.userId, ...lostPasskey },
      },
      envelopeFormat: "msgpack",
    });

    const recoveryKey = generateRecoveryKey();
    await addVaultCredential(await unlockOrThrow(lostPasskey), {
      type: "recovery_key",
      recoveryKey: recoveryKey.key,
    });

    await storeSecretWithCredential({
      secretType: "profile",
      plaintext: PROFILE,
      credential: {
        type: "passkey",
        context: { userId: state.userId, ...lostPasskey },
      },
      envelopeFormat: "json",
    });

    const profile = await loadSecretWithCredential({
      secretType: "profile",
      credential: { type: "recovery_key", recoveryKey: recoveryKey.key },
    });
    expect(profile?.plaintext).toEqual(PROFILE);

    const access = await caller().access();
    expect(access?.recoveryKey).not.toBeNull();
    expect(access?.unlockingCount).toBe(1);
  });

  it("rejects a recovery key that belongs to someone else", async () => {
    const passkey = passkeyMaterial();
    await createVault({
      type: "passkey",
      context: { userId: state.userId, ...passkey },
    });
    await addVaultCredential(await unlockOrThrow(passkey), {
      type: "recovery_key",
      recoveryKey: generateRecoveryKey().key,
    });

    await expect(
      unlockVaultKey({
        type: "recovery_key",
        recoveryKey: generateRecoveryKey().key,
      })
    ).rejects.toThrow("This recovery key doesn't match your account.");
  });

  it("moves the vault to a new passkey and retires the lost one", async () => {
    const lostPasskey = passkeyMaterial();
    await createVault({
      type: "passkey",
      context: { userId: state.userId, ...lostPasskey },
    });
    const recoveryKey = generateRecoveryKey();
    await addVaultCredential(await unlockOrThrow(lostPasskey), {
      type: "recovery_key",
      recoveryKey: recoveryKey.key,
    });

    const newPasskey = passkeyMaterial();
    const vaultKey = await unlockOrThrow({
      type: "recovery_key",
      recoveryKey: recoveryKey.key,
    });
    await addVaultCredential(vaultKey, newPasskey);
    await removeVaultCredential(lostPasskey.credentialId);

    await expect(verifyVaultCredential(newPasskey)).resolves.toEqual([
      "fhe_keys",
      "profile",
    ]);
    await expect(unlockVaultKey(lostPasskey)).rejects.toThrow(
      "This passkey can't open your encrypted data."
    );
  });

  it("reconnects a reset password through the recovery key", async () => {
    const oldPassword = opaqueMaterial();
    await createVault({
      type: "opaque",
      context: { userId: state.userId, exportKey: oldPassword.exportKey },
    });
    const recoveryKey = generateRecoveryKey();
    await addVaultCredential(await unlockOrThrow(oldPassword), {
      type: "recovery_key",
      recoveryKey: recoveryKey.key,
    });
    await db
      .insert(credentialBindingCommitments)
      .values({
        id: crypto.randomUUID(),
        secretId: (await caller().access())?.secretId ?? "",
        userId: state.userId,
        credentialId: "opaque",
        credentialKind: "opaque",
        commitment: "0x01",
      })
      .run();

    await detachVaultCredential(state.userId, "opaque");

    const [binding] = await db
      .select({ revokedAt: credentialBindingCommitments.revokedAt })
      .from(credentialBindingCommitments)
      .where(eq(credentialBindingCommitments.userId, state.userId))
      .all();
    expect(binding?.revokedAt).not.toBeNull();

    const newPassword = opaqueMaterial();
    await expect(unlockVaultKey(newPassword)).rejects.toThrow(
      "This password can't open your encrypted data."
    );

    const vaultKey = await unlockOrThrow({
      type: "recovery_key",
      recoveryKey: recoveryKey.key,
    });
    await addVaultCredential(vaultKey, newPassword);

    await expect(verifyVaultCredential(newPassword)).resolves.toEqual([
      "fhe_keys",
      "profile",
    ]);
  });

  it("reports a vault no remaining credential can open and resets it", async () => {
    const lostPasskey = passkeyMaterial();
    await createVault({
      type: "passkey",
      context: { userId: state.userId, ...lostPasskey },
    });
    await db
      .insert(accounts)
      .values({
        id: crypto.randomUUID(),
        accountId: crypto.randomUUID(),
        providerId: "opaque",
        userId: state.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    await db
      .insert(identityBundles)
      .values({
        userId: state.userId,
        fheKeyId: "key-1",
        fheStatus: "complete",
      })
      .run();

    const access = await caller().access();
    expect(access?.password).toEqual({ connected: false });
    expect(access?.unlockingCount).toBe(0);

    await expect(unlockVaultKey(opaqueMaterial())).rejects.toThrow(
      "This password can't open your encrypted data."
    );

    await expect(
      removeVaultCredential(lostPasskey.credentialId)
    ).rejects.toThrow("Add another way to open your encrypted data");

    await caller().resetVault();

    const remaining = await db
      .select({ id: encryptedSecrets.id })
      .from(encryptedSecrets)
      .where(eq(encryptedSecrets.userId, state.userId))
      .all();
    expect(remaining).toEqual([]);
    const bundle = await db
      .select({ fheKeyId: identityBundles.fheKeyId })
      .from(identityBundles)
      .where(eq(identityBundles.userId, state.userId))
      .get();
    expect(bundle?.fheKeyId).toBeNull();
    await expect(caller().access()).resolves.toBeNull();
  });

  it("refuses non-vault wrappers for secrets other than the root", async () => {
    const password = opaqueMaterial();
    await createVault({
      type: "opaque",
      context: { userId: state.userId, exportKey: password.exportKey },
    });
    const profile = await caller().getSecretBundle({ secretType: "profile" });
    expect(profile.wrappers.map((w) => w.credentialId)).toEqual(["vault"]);

    const secretId = crypto.randomUUID();
    await expect(
      caller().storeSecret({
        secretId,
        secretType: "profile",
        blobRef: crypto.createHash("sha256").update(secretId).digest("hex"),
        blobHash: "0".repeat(64),
        blobSize: 1,
        wrappedDek: JSON.stringify({
          alg: "AES-GCM",
          iv: "a",
          ciphertext: "b",
        }),
        credentialId: "opaque",
        kekSource: "opaque",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Vault secrets must be wrapped under the vault key.",
    });
  });
});

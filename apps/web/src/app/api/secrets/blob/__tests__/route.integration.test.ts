import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBrowserSession: vi.fn(),
  writeSecretBlob: vi.fn(),
}));

vi.mock("@/lib/auth/resource-auth", () => ({
  requireBrowserSession: mocks.requireBrowserSession,
}));

vi.mock("@/lib/privacy/secrets/storage.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/privacy/secrets/storage.server")
  >()),
  writeSecretBlob: mocks.writeSecretBlob,
}));

import { db } from "@/lib/db/connection";
import { encryptedSecrets } from "@/lib/db/schema/privacy";
import { computeSecretBlobRef } from "@/lib/privacy/secrets/storage.server";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { POST } from "../route";

function upload(secretId: string) {
  return POST(
    new Request("http://localhost/api/secrets/blob", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Secret-Id": secretId,
        "X-Secret-Type": "fhe_keys",
      },
      body: new Uint8Array([1, 2, 3]),
    })
  );
}

async function storeSecret(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(encryptedSecrets)
    .values({
      id,
      userId,
      secretType: "fhe_keys",
      encryptedBlob: "",
      blobRef: computeSecretBlobRef(id),
      blobHash: "a".repeat(64),
      blobSize: 3,
    })
    .run();
  return id;
}

describe("POST /api/secrets/blob", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    userId = await createTestUser();
    mocks.requireBrowserSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });
    mocks.writeSecretBlob.mockImplementation(
      ({ secretId }: { secretId: string }) => ({
        blobRef: computeSecretBlobRef(secretId),
        blobHash: "b".repeat(64),
        blobSize: 3,
      })
    );
  });

  it("stores the blob of a new secret", async () => {
    const response = await upload(crypto.randomUUID());

    expect(response.status).toBe(201);
    expect(mocks.writeSecretBlob).toHaveBeenCalledOnce();
  });

  it("never overwrites the blob of a stored secret", async () => {
    const own = await storeSecret(userId);
    const someoneElses = await storeSecret(await createTestUser());

    for (const secretId of [own, someoneElses]) {
      expect((await upload(secretId)).status).toBe(409);
    }
    expect(mocks.writeSecretBlob).not.toHaveBeenCalled();
  });
});

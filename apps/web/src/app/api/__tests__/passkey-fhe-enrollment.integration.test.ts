import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

import { POST as completeEnrollment } from "@/app/api/fhe/enrollment/complete/route";
import { POST as uploadSecretBlob } from "@/app/api/secrets/blob/route";
import {
  createFheEnrollmentContext,
  getFheEnrollmentContext,
  isRegistrationTokenValid,
} from "@/lib/auth/fhe-enrollment-tokens";
import { db } from "@/lib/db/connection";
import { getEncryptedSecretByUserAndType } from "@/lib/db/queries/crypto";
import { secretWrappers } from "@/lib/db/schema/crypto";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("passkey FHE enrollment integration", () => {
  let blobDir = "";

  beforeEach(async () => {
    await resetDatabase();
    blobDir = join(process.cwd(), ".data", "test-secret-blobs", randomUUID());
    process.env.SECRET_BLOB_DIR = blobDir;
    await rm(blobDir, { recursive: true, force: true });
    authMocks.requireSession.mockReset();
  });

  afterEach(async () => {
    await rm(blobDir, { recursive: true, force: true });
  });

  it("finalizes FHE enrollment after pre-auth blob upload", async () => {
    const userId = await createTestUser({ email: "anon@example.com" });
    const { contextToken, registrationToken } =
      await createFheEnrollmentContext({
        userId,
        email: "anon@example.com",
      });

    const secretId = "secret-1";
    const secretType = "fhe_keys";
    const blobPayload = new Uint8Array([1, 2, 3]);

    const blobResponse = await uploadSecretBlob(
      new Request("http://localhost/api/secrets/blob", {
        method: "POST",
        headers: {
          authorization: `Bearer ${registrationToken}`,
          "x-secret-id": secretId,
          "x-secret-type": secretType,
        },
        body: blobPayload,
      })
    );

    expect(blobResponse.status).toBe(201);

    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: userId } },
    });

    const completionResponse = await completeEnrollment(
      new Request("http://localhost/api/fhe/enrollment/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationToken,
          wrappedDek: "wrapped-dek",
          prfSalt: "prf-salt",
          credentialId: "credential-1",
          keyId: "key-1",
          version: "v1",
          kekVersion: "v1",
          envelopeFormat: "msgpack",
        }),
      })
    );

    expect(completionResponse.status).toBe(200);
    await expect(completionResponse.json()).resolves.toEqual({
      success: true,
      keyId: "key-1",
    });

    const storedSecret = await getEncryptedSecretByUserAndType(
      userId,
      secretType
    );
    expect(storedSecret).not.toBeNull();
    expect(storedSecret?.blobRef).toBeTruthy();
    expect(storedSecret?.metadata?.envelopeFormat).toBe("msgpack");
    expect(storedSecret?.metadata?.keyId).toBe("key-1");

    const wrapper = await db
      .select()
      .from(secretWrappers)
      .where(eq(secretWrappers.secretId, secretId))
      .get();
    expect(wrapper).not.toBeNull();
    expect(wrapper?.credentialId).toBe("credential-1");

    await expect(getFheEnrollmentContext(contextToken)).resolves.toBeNull();
    await expect(isRegistrationTokenValid(registrationToken)).resolves.toBe(
      false
    );
  });
});

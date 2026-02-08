import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

const enrollmentMocks = vi.hoisted(() => ({
  consumeRegistrationBlob: vi.fn(),
  consumeFheEnrollmentContext: vi.fn(),
  getFheEnrollmentContext: vi.fn(),
}));

vi.mock("@/lib/auth/fhe-enrollment-tokens", () => enrollmentMocks);

const cryptoMocks = vi.hoisted(() => ({
  deleteEncryptedSecretByUserAndType: vi.fn(),
  getEncryptedSecretByUserAndType: vi.fn(),
  upsertEncryptedSecret: vi.fn(),
  upsertSecretWrapper: vi.fn(),
}));

vi.mock("@/lib/db/queries/crypto", () => cryptoMocks);

const identityMocks = vi.hoisted(() => ({
  getIdentityBundleByUserId: vi.fn(),
  updateIdentityBundleFheStatus: vi.fn(),
  upsertIdentityBundle: vi.fn(),
}));

vi.mock("@/lib/db/queries/identity", () => identityMocks);

vi.mock("@/lib/utils/base64", () => ({
  base64ToBytes: (val: string) => Buffer.from(val, "base64"),
  bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
}));

import { POST } from "../route";

// Valid 32-byte salt as base64
const VALID_PRF_SALT = Buffer.from(new Uint8Array(32).fill(0xab)).toString(
  "base64"
);
// Valid wrappedDek JSON structure
const VALID_WRAPPED_DEK = JSON.stringify({
  alg: "A256GCM",
  iv: "dGVzdGl2MTIzNDU2",
  ciphertext: "ZW5jcnlwdGVk",
});

const makeRequest = (payload: unknown) =>
  new Request("http://localhost/api/fhe/enrollment/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("fhe enrollment completion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    });

    const response = await POST(makeRequest({}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("validates payload schema", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });

    const response = await POST(makeRequest({ registrationToken: "" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid enrollment payload.",
    });
  });

  it("handles invalid registration tokens", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    enrollmentMocks.consumeRegistrationBlob.mockRejectedValue(
      new Error("Registration token invalid.")
    );

    const response = await POST(
      makeRequest({
        registrationToken: "bad-token",
        wrappedDek: VALID_WRAPPED_DEK,
        prfSalt: VALID_PRF_SALT,
        credentialId: "cred",
        keyId: "key",
        envelopeFormat: "msgpack",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Registration token invalid.",
    });
  });

  it("rejects mismatched enrollment context", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    enrollmentMocks.consumeRegistrationBlob.mockResolvedValue({
      contextToken: "ctx-token",
      blob: {
        secretId: "secret-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      },
    });
    enrollmentMocks.getFheEnrollmentContext.mockResolvedValue({
      userId: "user-2",
      email: null,
      registrationToken: "reg-token",
      createdAt: new Date().toISOString(),
    });

    const response = await POST(
      makeRequest({
        registrationToken: "reg-token",
        wrappedDek: VALID_WRAPPED_DEK,
        prfSalt: VALID_PRF_SALT,
        credentialId: "cred",
        keyId: "key",
        envelopeFormat: "msgpack",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "FHE enrollment context does not match session.",
    });
  });

  it("finalizes enrollment and stores wrapper metadata", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    enrollmentMocks.consumeRegistrationBlob.mockResolvedValue({
      contextToken: "ctx-token",
      blob: {
        secretId: "secret-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      },
    });
    enrollmentMocks.getFheEnrollmentContext.mockResolvedValue({
      userId: "user-1",
      email: null,
      registrationToken: "reg-token",
      createdAt: new Date().toISOString(),
    });
    cryptoMocks.getEncryptedSecretByUserAndType.mockResolvedValue(null);
    identityMocks.getIdentityBundleByUserId.mockResolvedValue({
      userId: "user-1",
      fheKeyId: null,
      fheStatus: null,
      fheError: null,
    });

    const response = await POST(
      makeRequest({
        registrationToken: "reg-token",
        wrappedDek: VALID_WRAPPED_DEK,
        prfSalt: VALID_PRF_SALT,
        credentialId: "cred",
        keyId: "key",
        envelopeFormat: "msgpack",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      keyId: "key",
    });

    expect(cryptoMocks.upsertEncryptedSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "secret-1",
        userId: "user-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
        metadata: { envelopeFormat: "msgpack", keyId: "key" },
      })
    );

    expect(cryptoMocks.upsertSecretWrapper).toHaveBeenCalledWith(
      expect.objectContaining({
        secretId: "secret-1",
        userId: "user-1",
        credentialId: "cred",
        wrappedDek: VALID_WRAPPED_DEK,
        prfSalt: VALID_PRF_SALT,
      })
    );

    expect(identityMocks.updateIdentityBundleFheStatus).toHaveBeenCalledWith({
      userId: "user-1",
      fheKeyId: "key",
      fheStatus: "complete",
      fheError: null,
    });
    expect(enrollmentMocks.consumeFheEnrollmentContext).toHaveBeenCalledWith(
      "ctx-token"
    );
  });
});

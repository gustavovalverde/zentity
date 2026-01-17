import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

const onboardingMocks = vi.hoisted(() => ({
  consumeRegistrationBlob: vi.fn(),
  consumeOnboardingContext: vi.fn(),
  getOnboardingContext: vi.fn(),
}));

vi.mock("@/lib/auth/onboarding-tokens", () => onboardingMocks);

const cryptoMocks = vi.hoisted(() => ({
  deleteEncryptedSecretByUserAndType: vi.fn(),
  getEncryptedSecretByUserAndType: vi.fn(),
  updateEncryptedSecretMetadata: vi.fn(),
  upsertEncryptedSecret: vi.fn(),
  upsertSecretWrapper: vi.fn(),
}));

vi.mock("@/lib/db/queries/crypto", () => cryptoMocks);

import { POST } from "../route";

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
    onboardingMocks.consumeRegistrationBlob.mockRejectedValue(
      new Error("Registration token invalid.")
    );

    const response = await POST(
      makeRequest({
        registrationToken: "bad-token",
        wrappedDek: "wrapped",
        prfSalt: "salt",
        credentialId: "cred",
        keyId: "key",
        version: "v1",
        kekVersion: "v1",
        envelopeFormat: "msgpack",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Registration token invalid.",
    });
  });

  it("rejects mismatched onboarding context", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    onboardingMocks.consumeRegistrationBlob.mockResolvedValue({
      contextToken: "ctx-token",
      blob: {
        secretId: "secret-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      },
    });
    onboardingMocks.getOnboardingContext.mockResolvedValue({
      userId: "user-2",
      email: null,
      registrationToken: "reg-token",
      createdAt: new Date().toISOString(),
    });

    const response = await POST(
      makeRequest({
        registrationToken: "reg-token",
        wrappedDek: "wrapped",
        prfSalt: "salt",
        credentialId: "cred",
        keyId: "key",
        version: "v1",
        kekVersion: "v1",
        envelopeFormat: "msgpack",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Onboarding context does not match session.",
    });
  });

  it("finalizes enrollment and stores wrapper metadata", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    onboardingMocks.consumeRegistrationBlob.mockResolvedValue({
      contextToken: "ctx-token",
      blob: {
        secretId: "secret-1",
        secretType: "fhe_keys",
        blobRef: "blob-ref",
        blobHash: "blob-hash",
        blobSize: 123,
      },
    });
    onboardingMocks.getOnboardingContext.mockResolvedValue({
      userId: "user-1",
      email: null,
      registrationToken: "reg-token",
      createdAt: new Date().toISOString(),
    });
    cryptoMocks.getEncryptedSecretByUserAndType.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        registrationToken: "reg-token",
        wrappedDek: "wrapped",
        prfSalt: "salt",
        credentialId: "cred",
        keyId: "key",
        version: "v1",
        kekVersion: "v1",
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
        metadata: { envelopeFormat: "msgpack" },
        version: "v1",
      })
    );

    expect(cryptoMocks.upsertSecretWrapper).toHaveBeenCalledWith(
      expect.objectContaining({
        secretId: "secret-1",
        userId: "user-1",
        credentialId: "cred",
        wrappedDek: "wrapped",
        prfSalt: "salt",
        kekVersion: "v1",
      })
    );

    expect(cryptoMocks.updateEncryptedSecretMetadata).toHaveBeenCalledWith({
      userId: "user-1",
      secretType: "fhe_keys",
      metadata: { envelopeFormat: "msgpack", keyId: "key" },
    });
    expect(onboardingMocks.consumeOnboardingContext).toHaveBeenCalledWith(
      "ctx-token"
    );
  });
});

import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

const enrollmentMocks = vi.hoisted(() => ({
  isRegistrationTokenValid: vi.fn(),
}));

vi.mock("@/lib/auth/fhe-enrollment-tokens", () => enrollmentMocks);

const fheMocks = vi.hoisted(() => ({
  registerFheKey: vi.fn(),
}));

vi.mock("@/lib/privacy/crypto/fhe-client", () => fheMocks);

const dbMocks = vi.hoisted(() => ({
  getEncryptedSecretByUserAndType: vi.fn(),
  updateEncryptedSecretMetadata: vi.fn(),
}));

vi.mock("@/lib/db/queries/crypto", () => dbMocks);

import { POST } from "../route";

const makeRequest = (payload: unknown) =>
  new Request("http://localhost/api/fhe/keys/register", {
    method: "POST",
    body: encode(payload),
  });

describe("fhe keys/register route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getSession.mockResolvedValue(null);
    enrollmentMocks.isRegistrationTokenValid.mockResolvedValue(false);
    dbMocks.getEncryptedSecretByUserAndType.mockResolvedValue(null);
  });

  it("rejects invalid msgpack", async () => {
    const req = new Request("http://localhost/api/fhe/keys/register", {
      method: "POST",
      body: new Uint8Array([0xc1]),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid msgpack payload.",
    });
  });

  it("requires non-empty key bytes", async () => {
    const req = makeRequest({
      serverKey: new Uint8Array([]),
      publicKey: new Uint8Array([1]),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "serverKey and publicKey must be non-empty byte arrays.",
    });
  });

  it("requires authentication when no registration token", async () => {
    const req = makeRequest({
      serverKey: new Uint8Array([1]),
      publicKey: new Uint8Array([2]),
    });

    const response = await POST(req);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
    expect(fheMocks.registerFheKey).not.toHaveBeenCalled();
  });

  it("reuses existing key id for authenticated users", async () => {
    authMocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    dbMocks.getEncryptedSecretByUserAndType.mockResolvedValue({
      metadata: { keyId: "existing-key" },
    });

    const response = await POST(
      makeRequest({
        serverKey: new Uint8Array([1]),
        publicKey: new Uint8Array([2]),
      })
    );

    expect(response.status).toBe(200);
    const payload = decode(new Uint8Array(await response.arrayBuffer())) as {
      keyId: string;
    };
    expect(payload).toEqual({ keyId: "existing-key" });
    expect(fheMocks.registerFheKey).not.toHaveBeenCalled();
  });

  it("rejects invalid registration token", async () => {
    enrollmentMocks.isRegistrationTokenValid.mockResolvedValue(false);

    const response = await POST(
      makeRequest({
        serverKey: new Uint8Array([1]),
        publicKey: new Uint8Array([2]),
        registrationToken: "bad-token",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid or expired registration token.",
    });
  });

  it("registers key and updates metadata for authenticated users", async () => {
    authMocks.getSession.mockResolvedValue({ user: { id: "user-2" } });
    fheMocks.registerFheKey.mockResolvedValue({ keyId: "new-key" });

    const response = await POST(
      makeRequest({
        serverKey: new Uint8Array([9]),
        publicKey: new Uint8Array([8]),
      })
    );

    expect(response.status).toBe(200);
    const payload = decode(new Uint8Array(await response.arrayBuffer())) as {
      keyId: string;
    };
    expect(payload).toEqual({ keyId: "new-key" });
    expect(dbMocks.updateEncryptedSecretMetadata).toHaveBeenCalledWith({
      userId: "user-2",
      secretType: "fhe_keys",
      metadata: { keyId: "new-key" },
    });
  });
});

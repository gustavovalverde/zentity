import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({
  requireSession: authMocks.requireSession,
}));

const fheMocks = vi.hoisted(() => ({
  verifyAgeFhe: vi.fn(),
}));

vi.mock("@/lib/crypto/fhe-client", () => fheMocks);

const dbMocks = vi.hoisted(() => ({
  getLatestEncryptedAttributeByUserAndType: vi.fn(),
}));

vi.mock("@/lib/db/queries/crypto", () => dbMocks);

import { POST } from "../route";

const makeRequest = (payload?: unknown) =>
  new Request("http://localhost/api/fhe/verify-age", {
    method: "POST",
    body: payload === undefined ? undefined : encode(payload),
  });

describe("fhe verify-age route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireSession.mockResolvedValue({
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    });
    dbMocks.getLatestEncryptedAttributeByUserAndType.mockResolvedValue(null);
  });

  it("requires authentication", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  });

  it("rejects invalid msgpack", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    const req = new Request("http://localhost/api/fhe/verify-age", {
      method: "POST",
      body: new Uint8Array([0xc1]),
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid msgpack payload.",
    });
  });

  it("returns 404 when ciphertext is missing", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });

    const response = await POST(makeRequest());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Encrypted birth year offset not found.",
    });
  });

  it("rejects mismatched key id", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    dbMocks.getLatestEncryptedAttributeByUserAndType.mockResolvedValue({
      ciphertext: Buffer.from([1, 2, 3]),
      keyId: "key-1",
    });

    const response = await POST(makeRequest({ keyId: "key-2" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "FHE key mismatch.",
    });
  });

  it("verifies age with stored ciphertext", async () => {
    authMocks.requireSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    dbMocks.getLatestEncryptedAttributeByUserAndType.mockResolvedValue({
      ciphertext: Buffer.from([1, 2, 3]),
      keyId: "key-1",
    });
    fheMocks.verifyAgeFhe.mockResolvedValue({
      resultCiphertext: new Uint8Array([9, 9]),
    });

    const response = await POST(makeRequest({ minAge: 21 }));
    expect(response.status).toBe(200);

    const payload = decode(new Uint8Array(await response.arrayBuffer())) as {
      resultCiphertext: Uint8Array;
      computationTimeMs: number;
    };
    expect(payload.resultCiphertext).toEqual(new Uint8Array([9, 9]));
    expect(typeof payload.computationTimeMs).toBe("number");
    expect(fheMocks.verifyAgeFhe).toHaveBeenCalledWith(
      expect.objectContaining({
        ciphertext: Buffer.from([1, 2, 3]),
        minAge: 21,
        keyId: "key-1",
      })
    );
  });
});

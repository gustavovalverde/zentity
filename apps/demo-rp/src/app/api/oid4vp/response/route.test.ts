// @vitest-environment node

import { CompactEncrypt, exportJWK, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVpSessionByState: vi.fn(),
  updateVpSession: vi.fn(),
  verifyVpToken: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://rp.example" },
}));
vi.mock("@/lib/oid4vp", () => ({
  getVpSessionByState: mocks.getVpSessionByState,
  updateVpSession: mocks.updateVpSession,
}));
vi.mock("@/lib/verify", () => ({ verifyVpToken: mocks.verifyVpToken }));

import { POST } from "./route";

const CLIENT_ID = "x509_hash:leaf-thumbprint";

async function encryptedResponse(payload: Record<string, unknown>) {
  const { privateKey, publicKey } = await generateKeyPair("ECDH-ES", {
    crv: "P-256",
    extractable: true,
  });
  const response = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(payload))
  )
    .setProtectedHeader({ alg: "ECDH-ES", enc: "A256GCM" })
    .encrypt(publicKey);
  return {
    encryptionKey: JSON.stringify(await exportJWK(privateKey)),
    response,
  };
}

describe("POST /api/oid4vp/response", () => {
  beforeEach(() => {
    mocks.getVpSessionByState.mockReset();
    mocks.updateVpSession.mockReset();
    mocks.verifyVpToken.mockReset();
  });

  it("verifies the KB-JWT audience against the session's client_id", async () => {
    const { encryptionKey, response } = await encryptedResponse({
      vp_token: "vp-token",
    });
    mocks.getVpSessionByState.mockResolvedValue({
      id: "session-1",
      clientId: CLIENT_ID,
      encryptionKey,
      expiresAt: new Date(Date.now() + 60_000),
      nonce: "session-nonce",
      status: "pending",
    });
    mocks.verifyVpToken.mockResolvedValue({ verified: true });

    const res = await POST(
      new Request("https://rp.example/api/oid4vp/response", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "session-state", response }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyVpToken).toHaveBeenCalledWith(
      "vp-token",
      "session-nonce",
      CLIENT_ID
    );
    expect(mocks.updateVpSession).toHaveBeenCalledWith("session-1", {
      status: "verified",
      result: JSON.stringify({ verified: true }),
    });
  });
});

import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  signInPasskey: vi.fn(),
  listUserPasskeys: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    passkey: {
      addPasskey: authMocks.addPasskey,
      listUserPasskeys: authMocks.listUserPasskeys,
      updatePasskey: authMocks.updatePasskey,
      deletePasskey: authMocks.deletePasskey,
    },
    signIn: {
      passkey: authMocks.signInPasskey,
    },
  },
}));

const prfMocks = vi.hoisted(() => ({
  buildPrfExtension: vi.fn().mockReturnValue({ prf: { eval: { first: {} } } }),
  evaluatePrf: vi.fn(),
  extractPrfOutputFromClientResults: vi.fn(),
}));

vi.mock("@/lib/auth/webauthn-prf", () => prfMocks);

import { registerPasskeyWithPrf, signInWithPasskey } from "@/lib/auth/passkey";

describe("passkey auth wrapper", () => {
  it("registers a passkey and returns PRF output from WebAuthn response", async () => {
    const prfOutput = new Uint8Array(32).fill(1);
    authMocks.addPasskey.mockResolvedValue({
      data: { credentialID: "cred-1" },
      webauthn: {
        response: { id: "cred-1" },
        clientExtensionResults: {
          prf: { results: { first: prfOutput } },
        },
      },
    });
    prfMocks.extractPrfOutputFromClientResults.mockReturnValue(prfOutput);

    const result = await registerPasskeyWithPrf({
      name: "Primary",
      prfSalt: new Uint8Array(32).fill(7),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentialId).toBe("cred-1");
      expect(result.prfOutput).toEqual(prfOutput);
    }
    expect(prfMocks.evaluatePrf).not.toHaveBeenCalled();
  });

  it("returns error when passkey does not support PRF during registration", async () => {
    authMocks.addPasskey.mockResolvedValue({
      data: { credentialID: "cred-2" },
      webauthn: {
        response: { id: "cred-2", transports: ["internal"] },
        clientExtensionResults: {},
      },
    });
    prfMocks.extractPrfOutputFromClientResults.mockReturnValue(null);

    const result = await registerPasskeyWithPrf({
      name: "No PRF Support",
      prfSalt: new Uint8Array(32).fill(7),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("PRF extension");
    }
    // Should NOT fall back to evaluatePrf during registration (avoids double prompt)
    expect(prfMocks.evaluatePrf).not.toHaveBeenCalled();
  });

  it("returns an error when credential ID is missing", async () => {
    authMocks.addPasskey.mockResolvedValue({
      data: {},
      webauthn: {
        response: {},
        clientExtensionResults: {},
      },
    });
    prfMocks.extractPrfOutputFromClientResults.mockReturnValue(null);

    const result = await registerPasskeyWithPrf({
      name: "Missing ID",
      prfSalt: new Uint8Array(32).fill(7),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Missing passkey credential ID.");
    }
  });

  it("signs in with passkey without PRF when no salt is provided", async () => {
    authMocks.signInPasskey.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });

    const result = await signInWithPasskey();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ user: { id: "user-1" } });
    }
    expect(authMocks.signInPasskey).toHaveBeenCalledWith({
      returnWebAuthnResponse: false,
      extensions: undefined,
    });
  });
});

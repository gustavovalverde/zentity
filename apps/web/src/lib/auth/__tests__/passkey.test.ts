import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  getSession: vi.fn(),
  signInMagicLink: vi.fn(),
  signInPasskey: vi.fn(),
  listUserPasskeys: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    getSession: authMocks.getSession,
    passkey: {
      addPasskey: authMocks.addPasskey,
      listUserPasskeys: authMocks.listUserPasskeys,
      updatePasskey: authMocks.updatePasskey,
      deletePasskey: authMocks.deletePasskey,
    },
    signIn: {
      magicLink: authMocks.signInMagicLink,
      passkey: authMocks.signInPasskey,
    },
  },
}));

const prfMocks = vi.hoisted(() => ({
  buildPrfExtension: vi.fn().mockReturnValue({ prf: { eval: { first: {} } } }),
  evaluatePrf: vi.fn(),
  extractPrfOutputFromClientResults: vi.fn(),
}));

vi.mock("@/lib/auth/passkey/prf", () => prfMocks);

import {
  getPasskeyConfirmation,
  isReverificationRequired,
  type PasskeyConfirmationChoice,
  registerPasskeyWithPrf,
  signInWithPasskey,
  subscribePasskeyConfirmation,
  withPasskeyConfirmation,
} from "@/lib/auth/passkey/client";

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

describe("withPasskeyConfirmation", () => {
  const refusedByBetterAuth = {
    data: null,
    error: { code: "REVERIFICATION_REQUIRED", message: "Confirm it's you" },
  };
  const refusedByTrpc = Object.assign(new Error("Confirm it's you"), {
    data: { code: "FORBIDDEN", reason: "REVERIFICATION_REQUIRED" },
  });
  const owner = {
    id: "user-1",
    email: "owner@example.com",
    emailVerified: true,
  };
  const signedInAsOwner = { data: { session: {}, user: { id: owner.id } } };
  let prompts: (string | null)[];
  let unsubscribe: () => void;

  /** Answers the confirmation dialog with `choice` whenever it opens. */
  function answerWith(choice: PasskeyConfirmationChoice) {
    unsubscribe = subscribePasskeyConfirmation(() => {
      const request = getPasskeyConfirmation();
      if (request) {
        prompts.push(request.emailLinkTo);
        queueMicrotask(() => request.choose(choice));
      }
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribe?.();
    prompts = [];
    authMocks.getSession.mockResolvedValue({ data: { user: owner } });
    authMocks.signInPasskey.mockResolvedValue(signedInAsOwner);
    vi.stubGlobal("location", { pathname: "/dashboard/settings", search: "" });
  });

  it("recognizes both refusal shapes and nothing else", () => {
    expect(isReverificationRequired(refusedByBetterAuth.error)).toBe(true);
    expect(isReverificationRequired(refusedByTrpc)).toBe(true);
    expect(isReverificationRequired({ code: "SESSION_NOT_FRESH" })).toBe(false);
    expect(isReverificationRequired(new Error("boom"))).toBe(false);
  });

  it("asks first, then signs in with a passkey and retries a refused Better Auth call", async () => {
    answerWith("passkey");
    const action = vi
      .fn()
      .mockResolvedValueOnce(refusedByBetterAuth)
      .mockResolvedValueOnce({ data: { status: true }, error: null });

    await expect(withPasskeyConfirmation(action)).resolves.toEqual({
      data: { status: true },
      error: null,
    });
    expect(prompts).toEqual([owner.email]);
    expect(authMocks.signInPasskey).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("signs in with a passkey and retries a refused tRPC call", async () => {
    answerWith("passkey");
    const action = vi
      .fn()
      .mockRejectedValueOnce(refusedByTrpc)
      .mockResolvedValueOnce({ success: true });

    await expect(withPasskeyConfirmation(action)).resolves.toEqual({
      success: true,
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does not prompt for other failures", async () => {
    answerWith("passkey");
    const action = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withPasskeyConfirmation(action)).rejects.toThrow("boom");
    expect(prompts).toEqual([]);
    expect(authMocks.signInPasskey).not.toHaveBeenCalled();
  });

  it("changes nothing when the user cancels", async () => {
    answerWith("cancel");
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    await expect(withPasskeyConfirmation(action)).rejects.toThrow(
      "Nothing was changed."
    );
    expect(authMocks.signInPasskey).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });

  it("emails a sign-in link back to this page instead", async () => {
    answerWith("email_link");
    authMocks.signInMagicLink.mockResolvedValue({ data: { status: true } });
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    await expect(withPasskeyConfirmation(action)).rejects.toThrow(
      "We sent a sign-in link to owner@example.com"
    );
    expect(authMocks.signInMagicLink).toHaveBeenCalledWith({
      email: owner.email,
      callbackURL: "/dashboard/settings",
    });
    expect(authMocks.signInPasskey).not.toHaveBeenCalled();
  });

  it("offers no email link for an unverified or placeholder address", async () => {
    answerWith("cancel");
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    for (const user of [
      { ...owner, emailVerified: false },
      { ...owner, email: "0xabc@wallet.zentity.app" },
    ]) {
      authMocks.getSession.mockResolvedValue({ data: { user } });
      await expect(withPasskeyConfirmation(action)).rejects.toThrow();
    }
    expect(prompts).toEqual([null, null]);
  });

  it("stops when the passkey confirmation fails", async () => {
    answerWith("passkey");
    authMocks.signInPasskey.mockResolvedValue({
      data: null,
      error: { message: "cancelled" },
    });
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    await expect(withPasskeyConfirmation(action)).rejects.toThrow(
      "couldn't confirm it's you"
    );
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not retry when the passkey signed in to another account", async () => {
    answerWith("passkey");
    authMocks.signInPasskey.mockResolvedValue({
      data: { session: {}, user: { id: "someone-else" } },
    });
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    await expect(withPasskeyConfirmation(action)).rejects.toThrow(
      "belongs to another Zentity account"
    );
    expect(action).toHaveBeenCalledOnce();
  });

  it("explains a passkey that did not verify the user", async () => {
    answerWith("passkey");
    const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

    await expect(withPasskeyConfirmation(action)).rejects.toThrow(
      "didn't ask for your PIN, fingerprint, or face"
    );
    expect(action).toHaveBeenCalledTimes(2);
  });
});

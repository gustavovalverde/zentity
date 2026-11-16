import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  fetch: vi.fn(),
  getSession: vi.fn(),
  verifyPassword: vi.fn(),
  signInMagicLink: vi.fn(),
  signInPasskey: vi.fn(),
  listUserPasskeys: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    $fetch: authMocks.fetch,
    getSession: authMocks.getSession,
    opaque: { verifyPassword: authMocks.verifyPassword },
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

const recoveryOptions = vi.hoisted(() => vi.fn());
const BASE64URL_32_BYTES = /^[\w-]{43}$/;

vi.mock("@/lib/trpc/client", () => ({
  trpc: { account: { recoveryOptions: { query: recoveryOptions } } },
}));

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
    authMocks.deletePasskey.mockResolvedValue({ data: { status: true } });
    authMocks.addPasskey.mockResolvedValue({
      data: { id: "passkey-2", credentialID: "cred-2" },
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
    // The passkey it reported as failed must not keep signing in.
    expect(authMocks.deletePasskey).toHaveBeenCalledWith({ id: "passkey-2" });
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
    recoveryOptions.mockResolvedValue(null);
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

  describe("without the passkey", () => {
    const afterEmailLink = {
      available: {
        email: true,
        password: true,
        recoveryKey: true,
        wallet: false,
      },
      enrollment: "reverification_required",
      hasPasskey: true,
      hasPassword: true,
      passkeyReverified: false,
      proofs: ["magic_link"],
      signedInWithPasskey: false,
    };
    let requests: { error: string | null; password: boolean }[];

    /** Answers each prompt with the next choice, recording what it offered. */
    function answerInTurn(choices: PasskeyConfirmationChoice[]) {
      unsubscribe = subscribePasskeyConfirmation(() => {
        const request = getPasskeyConfirmation();
        const choice = choices.shift() ?? "cancel";
        if (request) {
          prompts.push(request.emailLinkTo);
          requests.push({ error: request.error, password: request.password });
          queueMicrotask(() => request.choose(choice));
        }
      });
    }

    beforeEach(() => {
      requests = [];
      recoveryOptions.mockResolvedValue(afterEmailLink);
    });

    it("asks for the password after an email link and retries", async () => {
      answerInTurn([{ password: "correct horse" }]);
      authMocks.verifyPassword.mockResolvedValue({
        data: { success: true, exportKey: new Uint8Array(64) },
        error: null,
      });
      const action = vi
        .fn()
        .mockResolvedValueOnce(refusedByBetterAuth)
        .mockResolvedValueOnce({ data: { status: true }, error: null });

      await expect(withPasskeyConfirmation(action)).resolves.toEqual({
        data: { status: true },
        error: null,
      });
      // The session already holds the email link, so none is offered again.
      expect(prompts).toEqual([null]);
      expect(authMocks.verifyPassword).toHaveBeenCalledWith({
        password: "correct horse",
      });
      expect(authMocks.signInPasskey).not.toHaveBeenCalled();
    });

    it("asks again after a wrong password", async () => {
      answerInTurn([{ password: "wrong" }, "cancel"]);
      authMocks.verifyPassword.mockResolvedValue({
        data: null,
        error: { message: "Invalid password" },
      });
      const action = vi.fn().mockResolvedValue(refusedByBetterAuth);

      await expect(withPasskeyConfirmation(action)).rejects.toThrow(
        "Nothing was changed."
      );
      expect(requests).toEqual([
        { error: null, password: true },
        { error: "That password is incorrect.", password: true },
      ]);
      expect(action).toHaveBeenCalledOnce();
    });

    it("offers a wallet the dialog confirms in the session, then retries", async () => {
      recoveryOptions.mockResolvedValue({
        ...afterEmailLink,
        available: { ...afterEmailLink.available, wallet: true },
      });
      let offeredWallet = false;
      unsubscribe = subscribePasskeyConfirmation(() => {
        const request = getPasskeyConfirmation();
        if (request) {
          offeredWallet = request.wallet;
          queueMicrotask(() => request.choose("wallet_confirmed"));
        }
      });
      const action = vi
        .fn()
        .mockResolvedValueOnce(refusedByBetterAuth)
        .mockResolvedValueOnce({ data: { status: true }, error: null });

      await expect(withPasskeyConfirmation(action)).resolves.toEqual({
        data: { status: true },
        error: null,
      });
      expect(offeredWallet).toBe(true);
      expect(authMocks.verifyPassword).not.toHaveBeenCalled();
      expect(authMocks.signInPasskey).not.toHaveBeenCalled();
    });

    it("proves the recovery key without sending its words", async () => {
      const words = `${"abandon ".repeat(23)}art`;
      answerInTurn([{ recoveryKey: words }]);
      authMocks.fetch.mockResolvedValue({
        data: { proof: "recovery_key" },
        error: null,
      });
      const action = vi
        .fn()
        .mockResolvedValueOnce(refusedByBetterAuth)
        .mockResolvedValueOnce({ data: { status: true }, error: null });

      await expect(withPasskeyConfirmation(action)).resolves.toEqual({
        data: { status: true },
        error: null,
      });
      expect(authMocks.fetch).toHaveBeenCalledOnce();
      const [path, request] = authMocks.fetch.mock.calls[0] as [
        string,
        { body: { verifier: string } },
      ];
      expect(path).toBe("/recovery-key/verify");
      expect(request.body.verifier).toMatch(BASE64URL_32_BYTES);
      expect(JSON.stringify(request)).not.toContain("abandon");
    });
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

import { ready, server } from "@serenity-kit/opaque";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { opaqueClient } from "../client";

const USER_ID = "opaque-user";

let serverSetup: string;
let serverPublicKey: string;
let registrationRecord: string | null;
let failPath: string | null;
let requestedPaths: string[];

beforeAll(async () => {
  await ready;
  serverSetup = server.createSetup();
  serverPublicKey = server.getPublicKey(serverSetup);
});

beforeEach(() => {
  registrationRecord = null;
  failPath = null;
  requestedPaths = [];
});

function registrationChallenge(body: { registrationRequest: string }) {
  return server.createRegistrationResponse({
    serverSetup,
    userIdentifier: USER_ID,
    registrationRequest: body.registrationRequest,
  }).registrationResponse;
}

function loginChallenge(body: { loginRequest: string }) {
  const { loginResponse, serverLoginState } = server.startLogin({
    serverSetup,
    userIdentifier: USER_ID,
    registrationRecord,
    startLoginRequest: body.loginRequest,
  });
  return { challenge: loginResponse, state: serverLoginState };
}

function loginComplete(body: {
  loginResult: string;
  encryptedServerState: string;
}) {
  server.finishLogin({
    serverLoginState: body.encryptedServerState,
    finishLoginRequest: body.loginResult,
  });
}

type Body = Record<string, string>;

function requireField(body: Body, field: string, expected: string): void {
  if (body[field] !== expected) {
    throw new Error(`Unexpected ${field}: ${body[field]}`);
  }
}

const routes: Record<string, (body: Body) => unknown> = {
  "/password/opaque/registration/challenge": (body) => ({
    challenge: registrationChallenge(body as { registrationRequest: string }),
  }),
  "/password/opaque/registration/complete": (body) => {
    registrationRecord = body.registrationRecord ?? null;
    return { success: true };
  },
  "/sign-up/opaque/challenge": (body) => ({
    challenge: registrationChallenge(body as { registrationRequest: string }),
    signupToken: `signup:${body.email}`,
  }),
  "/sign-up/opaque/complete": (body) => {
    requireField(body, "signupToken", "signup:user@example.com");
    registrationRecord = body.registrationRecord ?? null;
    return {
      success: true,
      token: "session-token",
      user: { id: USER_ID, email: "user@example.com" },
    };
  },
  "/sign-in/opaque/challenge": (body) => {
    requireField(body, "identifier", "user@example.com");
    return loginChallenge(body as { loginRequest: string });
  },
  "/sign-in/opaque/complete": (body) => {
    loginComplete(
      body as { loginResult: string; encryptedServerState: string }
    );
    return { success: true, token: "session-token", user: { id: USER_ID } };
  },
  "/password/opaque/verify/challenge": (body) =>
    loginChallenge(body as { loginRequest: string }),
  "/password/opaque/verify/complete": (body) => {
    loginComplete(
      body as { loginResult: string; encryptedServerState: string }
    );
    return { success: true };
  },
  "/password-reset/opaque/challenge": (body) => {
    requireField(body, "token", "reset-token");
    return {
      challenge: registrationChallenge(body as { registrationRequest: string }),
    };
  },
  "/password-reset/opaque/complete": (body) => {
    requireField(body, "token", "reset-token");
    registrationRecord = body.registrationRecord ?? null;
    return { success: true };
  },
};

function fetchStub<T>(path: string, options?: Record<string, unknown>) {
  requestedPaths.push(path);
  if (path === failPath) {
    return Promise.resolve({
      data: null,
      error: { message: "Server refused", status: 400 },
    });
  }
  const route = routes[path];
  if (!route) {
    throw new Error(`Unexpected path ${path}`);
  }
  const data = route((options?.body ?? {}) as Body) as T;
  return Promise.resolve({ data, error: null });
}

function actions(options: { serverPublicKey?: string } = {}) {
  return opaqueClient({ serverPublicKey, ...options }).getActions(fetchStub);
}

async function register(password: string): Promise<Uint8Array> {
  const result = await actions().opaque.setPassword({ password });
  if (!result.data) {
    throw new Error(result.error.message);
  }
  return result.data.exportKey;
}

describe("opaque client", () => {
  it("derives the same export key on registration, sign-in, and verification", async () => {
    const exportKey = await register("correct horse");
    expect(exportKey.byteLength).toBe(64);

    const signIn = await actions().signIn.opaque({
      identifier: "user@example.com",
      password: "correct horse",
    });
    expect(signIn.error).toBeNull();
    expect(signIn.data).toMatchObject({
      success: true,
      token: "session-token",
      user: { id: USER_ID },
    });
    expect(signIn.data?.exportKey).toEqual(exportKey);

    const verify = await actions().opaque.verifyPassword({
      password: "correct horse",
    });
    expect(verify).toEqual({
      data: { success: true, exportKey },
      error: null,
    });
  });

  it("signs up and returns the registration export key", async () => {
    const signUp = await actions().signUp.opaque({
      email: "user@example.com",
      password: "correct horse",
    });
    expect(signUp.data).toMatchObject({
      success: true,
      token: "session-token",
      user: { id: USER_ID, email: "user@example.com" },
    });

    const verify = await actions().opaque.verifyPassword({
      password: "correct horse",
    });
    expect(verify.data?.exportKey).toEqual(signUp.data?.exportKey);
  });

  it("changes the password and returns both export keys", async () => {
    const oldExportKey = await register("old password");

    const change = await actions().opaque.changePassword({
      currentPassword: "old password",
      newPassword: "new password",
    });
    expect(change.error).toBeNull();
    expect(change.data?.oldExportKey).toEqual(oldExportKey);
    expect(change.data?.exportKey).not.toEqual(oldExportKey);

    const verify = await actions().opaque.verifyPassword({
      password: "new password",
    });
    expect(verify.data?.exportKey).toEqual(change.data?.exportKey);
  });

  it("resets the password with a reset token", async () => {
    await register("old password");

    const reset = await actions().opaque.resetPassword({
      token: "reset-token",
      newPassword: "new password",
    });
    expect(reset.error).toBeNull();

    const verify = await actions().opaque.verifyPassword({
      password: "new password",
    });
    expect(verify.data?.exportKey).toEqual(reset.data?.exportKey);
  });

  it("reports a wrong password per flow", async () => {
    await register("correct horse");

    await expect(
      actions().signIn.opaque({
        identifier: "user@example.com",
        password: "wrong",
      })
    ).resolves.toEqual({ data: null, error: { message: "Login failed" } });
    await expect(
      actions().opaque.verifyPassword({ password: "wrong" })
    ).resolves.toEqual({ data: null, error: { message: "Invalid password" } });
    await expect(
      actions().opaque.changePassword({
        currentPassword: "wrong",
        newPassword: "new password",
      })
    ).resolves.toEqual({ data: null, error: { message: "Invalid password" } });
  });

  it("passes server error messages through", async () => {
    failPath = "/password/opaque/registration/challenge";
    await expect(
      actions().opaque.setPassword({ password: "correct horse" })
    ).resolves.toEqual({ data: null, error: { message: "Server refused" } });
  });

  it.each([
    [
      "sign-in",
      (a: ReturnType<typeof actions>) =>
        a.signIn.opaque({
          identifier: "user@example.com",
          password: "correct horse",
        }),
    ],
    [
      "verification",
      (a: ReturnType<typeof actions>) =>
        a.opaque.verifyPassword({ password: "correct horse" }),
    ],
    [
      "password change",
      (a: ReturnType<typeof actions>) =>
        a.opaque.changePassword({
          currentPassword: "correct horse",
          newPassword: "new password",
        }),
    ],
    [
      "password setup",
      (a: ReturnType<typeof actions>) =>
        a.opaque.setPassword({ password: "correct horse" }),
    ],
  ])("rejects an unpinned server key during %s", async (_flow, run) => {
    await register("correct horse");
    const untrusted = actions({
      serverPublicKey: server.getPublicKey(server.createSetup()),
    });
    requestedPaths = [];

    await expect(run(untrusted)).resolves.toEqual({
      data: null,
      error: { message: "Untrusted OPAQUE server key - possible MITM attack" },
    });
    expect(requestedPaths.filter((path) => path.endsWith("/complete"))).toEqual(
      []
    );
  });
});

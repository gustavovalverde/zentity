import type { Account } from "better-auth";

import { ready, server } from "@serenity-kit/opaque";

import {
  createDummyRegistrationRecord,
  decryptServerLoginState,
  encryptServerLoginState,
  findOpaqueAccount,
  LOGIN_REQUEST_LENGTH,
  validateBase64Length,
} from "./utils";

const normalizeIdentifier = (identifier: string) =>
  identifier.trim().toLowerCase();

export interface ResolvedUser {
  accounts: Account[];
  user: { id: string };
}

export interface StartOpaqueLoginParams {
  identifier: string;
  loginRequest: string;
  resolveUser: (identifier: string) => Promise<ResolvedUser | null>;
  secret: string;
  serverSetup: string;
}

export interface StartOpaqueLoginResult {
  challenge: string;
  serverPublicKey: string;
  state: string;
}

/**
 * Executes the first round of the OPAQUE login protocol.
 * Timing-safe: produces identical-looking output for non-existent users.
 */
export async function startOpaqueLogin(
  params: StartOpaqueLoginParams
): Promise<StartOpaqueLoginResult> {
  await ready;

  const identifier = normalizeIdentifier(params.identifier);
  if (identifier.length > 254 || identifier.length < 3) {
    throw new OpaqueLoginError("Invalid identifier format");
  }

  validateBase64Length(
    params.loginRequest,
    LOGIN_REQUEST_LENGTH,
    "login request"
  );

  const [
    { registrationRecord: dummyRecord, userIdentifier: dummyUserIdentifier },
    resolved,
  ] = await Promise.all([
    createDummyRegistrationRecord(),
    params.resolveUser(identifier),
  ]);

  const opaqueAccount = resolved
    ? findOpaqueAccount(resolved.accounts)
    : undefined;
  const registrationRecord = opaqueAccount?.registrationRecord || dummyRecord;
  const loginUserIdentifier =
    opaqueAccount?.registrationRecord && resolved
      ? resolved.user.id
      : dummyUserIdentifier;
  const userId =
    opaqueAccount?.registrationRecord && resolved ? resolved.user.id : null;

  const { serverLoginState, loginResponse } = server.startLogin({
    serverSetup: params.serverSetup,
    userIdentifier: loginUserIdentifier,
    registrationRecord,
    startLoginRequest: params.loginRequest,
  });

  const state = await encryptServerLoginState({
    serverLoginState,
    userId,
    secret: params.secret,
  });

  return {
    challenge: loginResponse,
    state,
    serverPublicKey: server.getPublicKey(params.serverSetup),
  };
}

export interface FinishOpaqueLoginParams {
  encryptedServerState: string;
  loginResult: string;
  secret: string;
}

/**
 * Executes the second round of the OPAQUE login protocol.
 * Returns the verified userId on success.
 * Throws OpaqueLoginError on authentication failure.
 */
export async function finishOpaqueLogin(
  params: FinishOpaqueLoginParams
): Promise<{ userId: string }> {
  await ready;

  const { serverLoginState, userId } = await decryptServerLoginState({
    encryptedState: params.encryptedServerState,
    secret: params.secret,
  });

  const { sessionKey } = server.finishLogin({
    finishLoginRequest: params.loginResult,
    serverLoginState,
  });

  if (!(sessionKey && userId)) {
    throw new OpaqueLoginError("Login failed");
  }

  return { userId };
}

export class OpaqueLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpaqueLoginError";
  }
}

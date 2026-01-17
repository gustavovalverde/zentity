import { client, server } from "@serenity-kit/opaque";
import { APIError, type Account } from "better-auth";
import {
  generateRandomString,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto";

export const REGISTRATION_REQUEST_LENGTH = 32;
export const REGISTRATION_RECORD_MIN_LENGTH = 170;
export const REGISTRATION_RECORD_MAX_LENGTH = 200;
export const LOGIN_REQUEST_LENGTH = 96;

const LOGIN_STATE_TTL_MS = 15 * 60 * 1000;
const LOGIN_STATE_PAD_LENGTH = 1024;

export function base64UrlDecode(str: string): Buffer {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const normalized = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64");
}

export function validateBase64Length(
  base64: string,
  expectedLength: number,
  fieldName: string
): void {
  const bytes = base64UrlDecode(base64);
  if (bytes.length !== expectedLength) {
    throw new APIError("BAD_REQUEST", {
      message: `Invalid ${fieldName}`,
    });
  }
}

export function validateBase64LengthRange(
  base64: string,
  min: number,
  max: number,
  fieldName: string
): void {
  const bytes = base64UrlDecode(base64);
  if (bytes.length < min || bytes.length > max) {
    throw new APIError("BAD_REQUEST", {
      message: `Invalid ${fieldName}`,
    });
  }
}

export async function createDummyRegistrationRecord(): Promise<{
  registrationRecord: string;
  userIdentifier: string;
}> {
  const tempServerSetup = server.createSetup();
  const userIdentifier = generateRandomString(12);
  const password = generateRandomString(24);

  const { registrationRequest, clientRegistrationState } =
    client.startRegistration({
      password,
    });

  const { registrationResponse } = server.createRegistrationResponse({
    registrationRequest,
    serverSetup: tempServerSetup,
    userIdentifier,
  });

  const { registrationRecord } = client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
  });

  return { registrationRecord, userIdentifier };
}

function padToLength(input: string, targetLength: number): string {
  const currentLength = Buffer.byteLength(input, "utf8");
  if (currentLength > targetLength) {
    throw new Error("Login payload exceeds target padding length.");
  }
  const paddingNeeded = targetLength - currentLength;
  return input + " ".repeat(paddingNeeded);
}

export async function encryptServerLoginState(params: {
  serverLoginState: string;
  userId: string | null;
  secret: string;
}): Promise<string> {
  return symmetricEncrypt({
    key: params.secret,
    data: padToLength(
      JSON.stringify({
        serverLoginState: params.serverLoginState,
        userId: params.userId,
        issuedAt: Date.now(),
      }),
      LOGIN_STATE_PAD_LENGTH
    ),
  });
}

export async function decryptServerLoginState(params: {
  encryptedState: string;
  secret: string;
}): Promise<{ serverLoginState: string; userId: string | null }> {
  const decrypted = await symmetricDecrypt({
    key: params.secret,
    data: params.encryptedState,
  });
  const data = JSON.parse(decrypted) as {
    serverLoginState?: string;
    userId?: string | null;
    issuedAt?: number;
  };

  if (!data.serverLoginState) {
    throw new APIError("BAD_REQUEST", {
      message: "Invalid login state",
    });
  }
  if (!data.issuedAt || data.issuedAt + LOGIN_STATE_TTL_MS < Date.now()) {
    throw new APIError("BAD_REQUEST", {
      message: "Login state has expired",
    });
  }

  return {
    serverLoginState: data.serverLoginState,
    userId: data.userId ?? null,
  };
}

export function findOpaqueAccount(
  accounts: Account[]
): (Account & { registrationRecord?: string | null }) | undefined {
  return accounts.find((account) => account.providerId === "opaque") as
    | (Account & { registrationRecord?: string | null })
    | undefined;
}

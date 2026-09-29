import type { APIRequestContext } from "@playwright/test";

import {
  client as opaqueProtocolClient,
  ready as opaqueProtocolReady,
} from "@serenity-kit/opaque";

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

function normalizeBase64(base64: string): string {
  const normalized = base64.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = normalized.length % 4;
  if (padLength === 0) {
    return normalized;
  }
  return `${normalized}${"=".repeat(4 - padLength)}`;
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  return base64ToBytes(normalizeBase64(base64Url));
}

export async function deriveOpaqueExportKey(
  api: APIRequestContext,
  password: string
): Promise<Uint8Array> {
  await opaqueProtocolReady;

  const { clientLoginState, startLoginRequest } =
    opaqueProtocolClient.startLogin({ password });

  const challengeResponse = await api.post(
    "/api/auth/password/opaque/verify/challenge",
    {
      data: { loginRequest: startLoginRequest },
    }
  );

  if (!challengeResponse.ok()) {
    throw new Error(
      `OPAQUE verify challenge failed: ${await challengeResponse.text()}`
    );
  }

  const challengeBody = (await challengeResponse.json()) as {
    challenge?: string;
    state?: string;
  };

  if (!(challengeBody.challenge && challengeBody.state)) {
    throw new Error("OPAQUE verify challenge response was invalid.");
  }

  const verifyResult = opaqueProtocolClient.finishLogin({
    clientLoginState,
    loginResponse: challengeBody.challenge,
    password,
  });
  if (!verifyResult) {
    throw new Error("OPAQUE login completion did not produce a client result.");
  }

  const completeResponse = await api.post(
    "/api/auth/password/opaque/verify/complete",
    {
      data: {
        loginResult: verifyResult.finishLoginRequest,
        encryptedServerState: challengeBody.state,
      },
    }
  );

  if (!completeResponse.ok()) {
    throw new Error(
      `OPAQUE verify completion failed: ${await completeResponse.text()}`
    );
  }

  return base64UrlToBytes(verifyResult.exportKey);
}

export async function ensureOpaquePasswordRegistration(
  api: APIRequestContext,
  password: string
): Promise<void> {
  await opaqueProtocolReady;

  const { clientRegistrationState, registrationRequest } =
    opaqueProtocolClient.startRegistration({ password });

  const challengeResponse = await api.post(
    "/api/auth/password/opaque/registration/challenge",
    {
      data: { registrationRequest },
    }
  );

  if (!challengeResponse.ok()) {
    throw new Error(
      `OPAQUE registration challenge failed: ${await challengeResponse.text()}`
    );
  }

  const challengeBody = (await challengeResponse.json()) as {
    challenge?: string;
  };

  if (!challengeBody.challenge) {
    throw new Error("OPAQUE registration challenge response was invalid.");
  }

  const registrationResult = opaqueProtocolClient.finishRegistration({
    clientRegistrationState,
    registrationResponse: challengeBody.challenge,
    password,
  });

  if (!registrationResult) {
    throw new Error(
      "OPAQUE registration completion did not produce a client result."
    );
  }

  const completeResponse = await api.post(
    "/api/auth/password/opaque/registration/complete",
    {
      data: {
        registrationRecord: registrationResult.registrationRecord,
      },
    }
  );

  if (!completeResponse.ok()) {
    throw new Error(
      `OPAQUE registration completion failed: ${await completeResponse.text()}`
    );
  }
}

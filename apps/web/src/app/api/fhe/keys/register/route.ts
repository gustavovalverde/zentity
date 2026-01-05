import { decode, encode } from "@msgpack/msgpack";

import { auth } from "@/lib/auth/auth";
import { isRegistrationTokenValid } from "@/lib/auth/registration-token";
import { registerFheKey } from "@/lib/crypto/fhe-client";
import {
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
} from "@/lib/db/queries/crypto";

export const runtime = "nodejs";

interface RegisterFheKeyPayload {
  serverKey: Uint8Array;
  publicKey: Uint8Array;
  registrationToken?: string;
}

function isNonEmptyBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0;
}

function msgpackResponse(data: unknown, status = 200): Response {
  return new Response(encode(data), {
    status,
    headers: {
      "Content-Type": "application/msgpack",
    },
  });
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  let payload: RegisterFheKeyPayload;
  try {
    payload = decode(
      new Uint8Array(await req.arrayBuffer())
    ) as RegisterFheKeyPayload;
  } catch {
    return jsonError("Invalid msgpack payload.", 400);
  }

  if (
    !(isNonEmptyBytes(payload.serverKey) && isNonEmptyBytes(payload.publicKey))
  ) {
    return jsonError(
      "serverKey and publicKey must be non-empty byte arrays.",
      400
    );
  }

  const registrationToken =
    typeof payload.registrationToken === "string" &&
    payload.registrationToken.length > 0
      ? payload.registrationToken
      : null;

  let userId: string | null = null;
  if (registrationToken) {
    if (!isRegistrationTokenValid(registrationToken)) {
      return jsonError("Invalid or expired registration token.", 400);
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return jsonError("Authentication required.", 401);
    }
    userId = session.user.id;

    const existingSecret = await getEncryptedSecretByUserAndType(
      userId,
      "fhe_keys"
    );
    const existingKeyId =
      existingSecret?.metadata &&
      typeof existingSecret.metadata.keyId === "string"
        ? existingSecret.metadata.keyId
        : null;
    if (existingKeyId) {
      return msgpackResponse({ keyId: existingKeyId });
    }
  }

  try {
    const { keyId } = await registerFheKey({
      serverKey: payload.serverKey,
      publicKey: payload.publicKey,
      requestId: req.headers.get("x-request-id") ?? undefined,
      flowId: req.headers.get("x-zentity-flow-id") ?? undefined,
    });

    if (userId) {
      await updateEncryptedSecretMetadata({
        userId,
        secretType: "fhe_keys",
        metadata: { keyId },
      });
    }

    return msgpackResponse({ keyId });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "FHE key registration failed.",
      502
    );
  }
}

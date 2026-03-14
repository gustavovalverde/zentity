import { decode } from "@msgpack/msgpack";

import { requireSession } from "@/lib/auth/api-auth";
import { isRegistrationTokenValid } from "@/lib/auth/fhe-enrollment-tokens";
import {
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
} from "@/lib/db/queries/crypto";
import { registerFheKey } from "@/lib/privacy/fhe/service";
import { sanitizeAndLogApiError } from "@/lib/utils/api-error";
import { jsonError, msgpackResponse } from "@/lib/utils/api-response";

export const runtime = "nodejs";

interface RegisterFheKeyPayload {
  publicKey: Uint8Array;
  registrationToken?: string;
  serverKey: Uint8Array;
}

function isNonEmptyBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0;
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
    if (!(await isRegistrationTokenValid(registrationToken))) {
      return jsonError("Invalid or expired registration token.", 400);
    }
  } else {
    const authResult = await requireSession(req.headers);
    if (!authResult.ok) {
      return authResult.response;
    }
    const sessionUserId = authResult.session.user.id;
    userId = sessionUserId;

    const existingSecret = await getEncryptedSecretByUserAndType(
      sessionUserId,
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
    const ref = sanitizeAndLogApiError(error, req, {
      operation: "fhe/keys/register",
    });
    return jsonError(`FHE key registration failed. (Ref: ${ref})`, 502);
  }
}

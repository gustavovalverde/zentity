import { decode } from "@msgpack/msgpack";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import {
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
} from "@/lib/db/queries/crypto";
import { registerFheKey } from "@/lib/privacy/fhe/service";
import {
  jsonError,
  msgpackResponse,
  sanitizeAndLogApiError,
} from "@/lib/utils/api-utils";
import { fheLimiter, rateLimitResponse } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

interface RegisterFheKeyPayload {
  publicKey: Uint8Array;
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

  const authResult = await requireBrowserSession(req.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const userId = authResult.session.user.id;

  const { limited, retryAfter } = fheLimiter.check(userId);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

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

  try {
    const { keyId } = await registerFheKey({
      serverKey: payload.serverKey,
      publicKey: payload.publicKey,
      requestId: req.headers.get("x-request-id") ?? undefined,
      flowId: req.headers.get("x-zentity-flow-id") ?? undefined,
    });

    await updateEncryptedSecretMetadata({
      userId,
      secretType: "fhe_keys",
      metadata: { keyId },
    });

    return msgpackResponse({ keyId });
  } catch (error) {
    const ref = sanitizeAndLogApiError(error, req, {
      operation: "fhe/keys/register",
    });
    return jsonError(`FHE key registration failed. (Ref: ${ref})`, 502);
  }
}

import { decode } from "@msgpack/msgpack";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/resource-auth";
import {
  getEncryptedSecretByUserAndType,
  updateEncryptedSecretMetadata,
} from "@/lib/db/queries/privacy";
import { fheLimiter, rateLimitResponse } from "@/lib/http/rate-limit";
import {
  jsonError,
  msgpackResponse,
  sanitizeAndLogApiError,
} from "@/lib/http/route-responses";
import { registerFheKey } from "@/lib/privacy/fhe/backend";

export const runtime = "nodejs";

const nonEmptyBytes = z.instanceof(Uint8Array).refine((v) => v.byteLength > 0);
const registerFheKeySchema = z.object({
  publicKey: nonEmptyBytes,
  serverKey: nonEmptyBytes,
});

export async function POST(req: Request) {
  const authResult = await requireBrowserSession(req.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  let decoded: unknown;
  try {
    decoded = decode(new Uint8Array(await req.arrayBuffer()));
  } catch {
    return jsonError("Invalid msgpack payload.", 400);
  }

  const parsed = registerFheKeySchema.safeParse(decoded);
  if (!parsed.success) {
    return jsonError(
      "serverKey and publicKey must be non-empty byte arrays.",
      400
    );
  }
  const payload = parsed.data;

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

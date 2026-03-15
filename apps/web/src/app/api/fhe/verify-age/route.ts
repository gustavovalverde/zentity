import { decode } from "@msgpack/msgpack";

import { requireSession } from "@/lib/auth/api-auth";
import { getLatestEncryptedAttributeByUserAndType } from "@/lib/db/queries/crypto";
import { getTodayDobDays } from "@/lib/identity/verification/birth-year";
import { verifyAgeFromDobFhe } from "@/lib/privacy/fhe/service";
import { sanitizeAndLogApiError } from "@/lib/utils/api-error";
import { jsonError, msgpackResponse } from "@/lib/utils/api-response";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { fheLimiter } from "@/lib/utils/rate-limiters";

export const runtime = "nodejs";

interface VerifyAgePayload {
  currentYear?: number;
  keyId?: string;
  minAge?: number;
}

export async function POST(req: Request) {
  const authResult = await requireSession(req.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = fheLimiter.check(authResult.session.user.id);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const userId = authResult.session.user.id;

  let payload: VerifyAgePayload = {};
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 0) {
    try {
      payload = decode(raw) as VerifyAgePayload;
    } catch {
      return jsonError("Invalid msgpack payload.", 400);
    }
  }

  const encrypted = await getLatestEncryptedAttributeByUserAndType(
    userId,
    "dob_days"
  );
  if (!encrypted?.ciphertext || encrypted.ciphertext.byteLength === 0) {
    return jsonError("Encrypted date of birth not found.", 404);
  }

  const keyId = payload.keyId ?? encrypted.keyId ?? null;
  if (!keyId) {
    return jsonError("FHE key id is missing.", 400);
  }
  if (payload.keyId && encrypted.keyId && payload.keyId !== encrypted.keyId) {
    return jsonError("FHE key mismatch.", 400);
  }

  try {
    const start = Date.now();
    const requestId = req.headers.get("x-request-id") ?? undefined;
    const flowId = req.headers.get("x-zentity-flow-id") ?? undefined;

    const result = await verifyAgeFromDobFhe({
      ciphertext: encrypted.ciphertext,
      currentDays: getTodayDobDays(),
      minAge: payload.minAge ?? 18,
      keyId,
      requestId,
      flowId,
    });

    return msgpackResponse({
      resultCiphertext: result.resultCiphertext,
      computationTimeMs: Date.now() - start,
    });
  } catch (error) {
    const ref = sanitizeAndLogApiError(error, req, {
      operation: "fhe/verify-age",
    });
    return jsonError(`FHE verification failed. (Ref: ${ref})`, 502);
  }
}

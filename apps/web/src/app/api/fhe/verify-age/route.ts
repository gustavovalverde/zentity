import { decode, encode } from "@msgpack/msgpack";

import { requireSession } from "@/lib/auth/api-auth";
import { getLatestEncryptedAttributeByUserAndType } from "@/lib/db/queries/crypto";
import { getTodayDobDays } from "@/lib/identity/verification/birth-year";
import { verifyAgeFromDobFhe } from "@/lib/privacy/fhe/service";

export const runtime = "nodejs";

interface VerifyAgePayload {
  keyId?: string;
  currentYear?: number;
  minAge?: number;
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
  const authResult = await requireSession(req.headers);
  if (!authResult.ok) {
    return jsonError("Authentication required.", 401);
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
    return jsonError(
      error instanceof Error ? error.message : "FHE verification failed.",
      502
    );
  }
}

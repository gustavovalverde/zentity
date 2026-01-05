import { decode, encode } from "@msgpack/msgpack";

import { auth } from "@/lib/auth/auth";
import { verifyAgeFhe } from "@/lib/crypto/fhe-client";
import { getLatestEncryptedAttributeByUserAndType } from "@/lib/db/queries/crypto";

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
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return jsonError("Authentication required.", 401);
  }

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
    session.user.id,
    "birth_year_offset"
  );
  if (!encrypted?.ciphertext) {
    return jsonError("Encrypted birth year offset not found.", 404);
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
    const result = await verifyAgeFhe({
      ciphertext: encrypted.ciphertext,
      currentYear: payload.currentYear ?? new Date().getFullYear(),
      minAge: payload.minAge ?? 18,
      keyId,
      requestId: req.headers.get("x-request-id") ?? undefined,
      flowId: req.headers.get("x-zentity-flow-id") ?? undefined,
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

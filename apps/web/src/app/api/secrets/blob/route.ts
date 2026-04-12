import { NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import {
  getEncryptedSecretById,
  getEncryptedSecretByUserAndType,
} from "@/lib/db/queries/privacy";
import { withSpan } from "@/lib/observability/telemetry";
import {
  computeSecretBlobRef,
  getSecretBlobMaxBytes,
  readSecretBlob,
  SecretBlobTooLargeError,
  writeSecretBlob,
} from "@/lib/privacy/secrets/storage.server";
import { sanitizeAndLogApiError } from "@/lib/utils/api-utils";
import { rateLimitResponse, secretsBlobLimiter } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

function getHeaderValue(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const authResult = await requireBrowserSession(request.headers);
    if (!authResult.ok) {
      return authResult.response;
    }

    const { limited, retryAfter } = secretsBlobLimiter.check(
      authResult.session.user.id
    );
    if (limited) {
      return rateLimitResponse(retryAfter) as NextResponse;
    }

    const secretId = getHeaderValue(request.headers, "x-secret-id");
    const secretType = getHeaderValue(request.headers, "x-secret-type");

    if (!(secretId && secretType)) {
      return NextResponse.json(
        { error: "Missing secret headers" },
        { status: 400 }
      );
    }

    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "Missing body" }, { status: 400 });
    }

    const maxBytes = getSecretBlobMaxBytes();
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const parsed = Number.parseInt(contentLength, 10);
      if (Number.isFinite(parsed) && parsed > maxBytes) {
        return NextResponse.json(
          { error: "Secret blob too large." },
          { status: 413 }
        );
      }
    }

    return await withSpan(
      "fhe.enrollment.upload_blob",
      {
        "secret.type": secretType,
        "secret.id": secretId,
        "blob.content_length": contentLength ?? undefined,
      },
      async () => {
        const blobMeta = await writeSecretBlob({
          secretId,
          body,
        });

        return NextResponse.json(blobMeta, { status: 201 });
      }
    );
  } catch (error) {
    if (error instanceof SecretBlobTooLargeError) {
      return NextResponse.json(
        { error: "Secret blob too large." },
        { status: 413 }
      );
    }
    const ref = sanitizeAndLogApiError(error, request, {
      operation: "secrets/blob",
    });
    return NextResponse.json(
      { error: `Failed to store secret. (Ref: ${ref})` },
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = secretsBlobLimiter.check(
    authResult.session.user.id
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const { searchParams } = new URL(request.url);
  const secretId = searchParams.get("secretId");
  const secretType = searchParams.get("secretType");

  let secret: Awaited<ReturnType<typeof getEncryptedSecretById>> | null = null;
  if (secretId) {
    secret = await getEncryptedSecretById(authResult.session.user.id, secretId);
  } else if (secretType) {
    secret = await getEncryptedSecretByUserAndType(
      authResult.session.user.id,
      secretType
    );
  }

  if (!secret?.blobRef) {
    return NextResponse.json({ error: "Secret not found" }, { status: 404 });
  }

  const expectedBlobRef = computeSecretBlobRef(secret.id);
  if (secret.blobRef !== expectedBlobRef) {
    console.warn(
      "[secrets/blob] blobRef mismatch for secret",
      secret.id,
      secret.blobRef
    );
  }

  const stream = await readSecretBlob({ blobRef: expectedBlobRef });
  if (!stream) {
    return NextResponse.json(
      { error: "Secret blob not found" },
      { status: 404 }
    );
  }

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      ...(secret.blobSize ? { "Content-Length": String(secret.blobSize) } : {}),
    },
  });
}

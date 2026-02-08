import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import {
  isRegistrationTokenValid,
  storeRegistrationBlob,
} from "@/lib/auth/fhe-enrollment-tokens";
import {
  getEncryptedSecretById,
  getEncryptedSecretByUserAndType,
} from "@/lib/db/queries/crypto";
import {
  computeSecretBlobRef,
  getSecretBlobMaxBytes,
  readSecretBlob,
  SecretBlobTooLargeError,
  writeSecretBlob,
} from "@/lib/privacy/secrets/storage.server";

export const runtime = "nodejs";

function getHeaderValue(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

function getRegistrationToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(" ");
  if (!(scheme && token)) {
    return null;
  }
  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token.trim() || null;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const registrationToken = getRegistrationToken(request.headers);
    const authResult = registrationToken
      ? null
      : await requireSession(request.headers);
    if (!registrationToken && authResult && !authResult.ok) {
      return authResult.response;
    }
    if (
      registrationToken &&
      !(await isRegistrationTokenValid(registrationToken))
    ) {
      return NextResponse.json(
        { error: "Invalid or expired registration token." },
        { status: 401 }
      );
    }

    const secretId = getHeaderValue(request.headers, "x-secret-id");
    const secretType = getHeaderValue(request.headers, "x-secret-type");

    if (!(secretId && secretType)) {
      return NextResponse.json(
        { error: "Missing secret headers" },
        { status: 400 }
      );
    }

    if (!request.body) {
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

    const blobMeta = await writeSecretBlob({
      secretId,
      body: request.body,
    });

    if (registrationToken) {
      await storeRegistrationBlob(registrationToken, {
        secretId,
        secretType,
        ...blobMeta,
      });
    }

    return NextResponse.json(blobMeta, { status: 201 });
  } catch (error) {
    if (error instanceof SecretBlobTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("[secrets/blob] POST error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const authResult = await requireSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
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
      ...(secret.blobHash ? { "X-Blob-Hash": secret.blobHash } : {}),
      ...(secret.blobSize ? { "Content-Length": String(secret.blobSize) } : {}),
    },
  });
}

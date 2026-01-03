import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import {
  readSecretBlob,
  writeSecretBlob,
} from "@/lib/crypto/secret-blob-store";
import {
  getEncryptedSecretById,
  getEncryptedSecretByUserAndType,
} from "@/lib/db/queries/crypto";

export const runtime = "nodejs";

function getHeaderValue(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const authResult = await requireSession();
  if (!authResult.ok) {
    return authResult.response;
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

  const blobMeta = await writeSecretBlob({
    secretId,
    body: request.body,
  });

  return NextResponse.json(blobMeta, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const secretId = searchParams.get("secretId");
  const secretType = searchParams.get("secretType");

  let secret: ReturnType<typeof getEncryptedSecretById> = null;
  if (secretId) {
    secret = getEncryptedSecretById(authResult.session.user.id, secretId);
  } else if (secretType) {
    secret = getEncryptedSecretByUserAndType(
      authResult.session.user.id,
      secretType
    );
  }

  if (!secret?.blobRef) {
    return NextResponse.json({ error: "Secret not found" }, { status: 404 });
  }

  const stream = await readSecretBlob({ blobRef: secret.blobRef });
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

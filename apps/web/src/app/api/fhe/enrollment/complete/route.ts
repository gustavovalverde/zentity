import { NextResponse } from "next/server";
import z from "zod";

import { requireSession } from "@/lib/auth/api-auth";
import {
  consumeFheEnrollmentContext,
  consumeRegistrationBlob,
  getFheEnrollmentContext,
} from "@/lib/auth/fhe-enrollment-tokens";
import {
  deleteEncryptedSecretByUserAndType,
  getEncryptedSecretByUserAndType,
  upsertEncryptedSecret,
  upsertSecretWrapper,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  updateIdentityBundleFheStatus,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { prfSaltSchema, wrappedDekSchema } from "@/lib/privacy/secrets/types";
import { sanitizeAndLogApiError } from "@/lib/utils/api-error";

export const runtime = "nodejs";

const enrollmentSchema = z.object({
  registrationToken: z.string().min(1),
  wrappedDek: wrappedDekSchema,
  prfSalt: prfSaltSchema,
  credentialId: z.string().min(1),
  keyId: z.string().min(1),
  envelopeFormat: z.enum(["json", "msgpack"]),
  baseCommitment: z.string().optional(),
});

export async function POST(request: Request) {
  const authResult = await requireSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const payload = (await request.json().catch(() => null)) as unknown;
  const parsed = enrollmentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid enrollment payload." },
      { status: 400 }
    );
  }

  const sessionUserId = authResult.session.user.id;
  const enrollment = parsed.data;

  if (enrollment.envelopeFormat !== "msgpack") {
    return NextResponse.json(
      { error: "Unsupported FHE envelope format." },
      { status: 400 }
    );
  }

  let registration: Awaited<ReturnType<typeof consumeRegistrationBlob>>;
  try {
    registration = await consumeRegistrationBlob(enrollment.registrationToken);
  } catch (error) {
    const ref = sanitizeAndLogApiError(error, request, {
      operation: "fhe/enrollment/complete",
    });
    return NextResponse.json(
      { error: `Registration token invalid or expired. (Ref: ${ref})` },
      { status: 400 }
    );
  }

  const context = await getFheEnrollmentContext(registration.contextToken);
  if (!context) {
    return NextResponse.json(
      { error: "FHE enrollment context expired." },
      { status: 400 }
    );
  }

  if (context.userId !== sessionUserId) {
    return NextResponse.json(
      { error: "FHE enrollment context does not match session." },
      { status: 403 }
    );
  }

  const secretType = "fhe_keys";
  if (registration.blob.secretType !== secretType) {
    return NextResponse.json(
      { error: "Registration secret type mismatch." },
      { status: 400 }
    );
  }

  const existingSecret = await getEncryptedSecretByUserAndType(
    sessionUserId,
    secretType
  );
  if (
    existingSecret &&
    existingSecret.id !== registration.blob.secretId &&
    existingSecret.userId === sessionUserId
  ) {
    await deleteEncryptedSecretByUserAndType(sessionUserId, secretType);
  }

  await upsertEncryptedSecret({
    id: registration.blob.secretId,
    userId: sessionUserId,
    secretType,
    encryptedBlob: "",
    blobRef: registration.blob.blobRef,
    blobHash: registration.blob.blobHash,
    blobSize: registration.blob.blobSize,
    metadata: {
      envelopeFormat: enrollment.envelopeFormat,
      keyId: enrollment.keyId,
    },
  });

  await upsertSecretWrapper({
    id: crypto.randomUUID(),
    secretId: registration.blob.secretId,
    userId: sessionUserId,
    credentialId: enrollment.credentialId,
    wrappedDek: enrollment.wrappedDek,
    prfSalt: enrollment.prfSalt,
    kekSource: "prf",
    baseCommitment: enrollment.baseCommitment,
  });

  // Persist enrollment status server-side to avoid client-side races where other
  // flows (document OCR / background jobs) run before the identity bundle is updated.
  const existingBundle = await getIdentityBundleByUserId(sessionUserId);
  if (existingBundle) {
    await updateIdentityBundleFheStatus({
      userId: sessionUserId,
      fheKeyId: enrollment.keyId,
      fheStatus: "complete",
      fheError: null,
    });
  } else {
    await upsertIdentityBundle({
      userId: sessionUserId,
      status: "pending",
      fheKeyId: enrollment.keyId,
      fheStatus: "complete",
      fheError: null,
    });
  }

  await consumeFheEnrollmentContext(registration.contextToken);

  return NextResponse.json(
    {
      success: true,
      keyId: enrollment.keyId,
    },
    { status: 200 }
  );
}

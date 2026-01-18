import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db/connection";
import { verifications } from "@/lib/db/schema/auth";

const CONTEXT_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const contextIdentifier = (token: string) => `fhe-enrollment:context:${token}`;
const registrationIdentifier = (token: string) =>
  `fhe-enrollment:registration:${token}`;

export interface RegistrationBlobMeta {
  secretId: string;
  secretType: string;
  blobRef: string;
  blobHash: string;
  blobSize: number;
}

interface FheEnrollmentContextValue {
  userId: string;
  email: string | null;
  registrationToken: string;
  createdAt: string;
}

interface RegistrationTokenValue {
  contextToken: string;
  blob?: RegistrationBlobMeta;
  createdAt: string;
}

function toIso(date: Date): string {
  return date.toISOString();
}

async function getVerificationByIdentifier(identifier: string) {
  const record = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .get();

  if (!record) {
    return null;
  }

  const expiresAt = new Date(record.expiresAt);
  if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date()) {
    await db.delete(verifications).where(eq(verifications.id, record.id)).run();
    return null;
  }

  return record;
}

export async function createFheEnrollmentContext(params: {
  userId: string;
  email?: string | null;
}): Promise<{
  contextToken: string;
  registrationToken: string;
  expiresAt: string;
}> {
  const contextToken = nanoid(32);
  const registrationToken = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONTEXT_TOKEN_TTL_MS);

  const contextValue: FheEnrollmentContextValue = {
    userId: params.userId,
    email: params.email ?? null,
    registrationToken,
    createdAt: toIso(now),
  };

  const registrationValue: RegistrationTokenValue = {
    contextToken,
    createdAt: toIso(now),
  };

  await db.insert(verifications).values([
    {
      id: crypto.randomUUID(),
      identifier: contextIdentifier(contextToken),
      value: JSON.stringify(contextValue),
      expiresAt: toIso(expiresAt),
      createdAt: toIso(now),
      updatedAt: toIso(now),
    },
    {
      id: crypto.randomUUID(),
      identifier: registrationIdentifier(registrationToken),
      value: JSON.stringify(registrationValue),
      expiresAt: toIso(expiresAt),
      createdAt: toIso(now),
      updatedAt: toIso(now),
    },
  ]);

  return {
    contextToken,
    registrationToken,
    expiresAt: toIso(expiresAt),
  };
}

export async function getFheEnrollmentContext(
  contextToken: string
): Promise<FheEnrollmentContextValue | null> {
  const record = await getVerificationByIdentifier(
    contextIdentifier(contextToken)
  );
  if (!record) {
    return null;
  }

  try {
    return JSON.parse(record.value) as FheEnrollmentContextValue;
  } catch {
    return null;
  }
}

export async function isRegistrationTokenValid(
  token: string
): Promise<boolean> {
  const record = await getVerificationByIdentifier(
    registrationIdentifier(token)
  );
  return Boolean(record);
}

export async function storeRegistrationBlob(
  token: string,
  blob: RegistrationBlobMeta
) {
  const record = await getVerificationByIdentifier(
    registrationIdentifier(token)
  );
  if (!record) {
    throw new Error("Invalid or expired registration token.");
  }

  let parsed: RegistrationTokenValue;
  try {
    parsed = JSON.parse(record.value) as RegistrationTokenValue;
  } catch {
    throw new Error("Invalid registration token payload.");
  }

  if (parsed.blob) {
    throw new Error("Registration blob already uploaded.");
  }

  const updated: RegistrationTokenValue = {
    ...parsed,
    blob,
  };

  await db
    .update(verifications)
    .set({ value: JSON.stringify(updated), updatedAt: toIso(new Date()) })
    .where(eq(verifications.id, record.id))
    .run();
}

export async function consumeRegistrationBlob(
  token: string
): Promise<{ blob: RegistrationBlobMeta; contextToken: string }> {
  const record = await getVerificationByIdentifier(
    registrationIdentifier(token)
  );
  if (!record) {
    throw new Error("Registration blob not found or expired.");
  }

  let parsed: RegistrationTokenValue;
  try {
    parsed = JSON.parse(record.value) as RegistrationTokenValue;
  } catch {
    throw new Error("Invalid registration token payload.");
  }

  if (!parsed.blob) {
    throw new Error("Registration blob not found or expired.");
  }

  await db.delete(verifications).where(eq(verifications.id, record.id)).run();

  return { blob: parsed.blob, contextToken: parsed.contextToken };
}

export async function consumeFheEnrollmentContext(contextToken: string) {
  const identifier = contextIdentifier(contextToken);
  const record = await getVerificationByIdentifier(identifier);
  if (!record) {
    return null;
  }

  await db.delete(verifications).where(eq(verifications.id, record.id)).run();
  try {
    return JSON.parse(record.value) as FheEnrollmentContextValue;
  } catch {
    return null;
  }
}

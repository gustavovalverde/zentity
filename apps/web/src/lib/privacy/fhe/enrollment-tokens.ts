import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db/connection";
import { verifications } from "@/lib/db/schema/auth";

const CONTEXT_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const contextIdentifier = (token: string) => `fhe-enrollment:context:${token}`;

interface FheEnrollmentContextValue {
  createdAt: string;
  email: string | null;
  userId: string;
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
  expiresAt: string;
}> {
  const contextToken = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONTEXT_TOKEN_TTL_MS);

  const contextValue: FheEnrollmentContextValue = {
    userId: params.userId,
    email: params.email ?? null,
    createdAt: toIso(now),
  };

  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier: contextIdentifier(contextToken),
    value: JSON.stringify(contextValue),
    expiresAt: toIso(expiresAt),
    createdAt: toIso(now),
    updatedAt: toIso(now),
  });

  return {
    contextToken,
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

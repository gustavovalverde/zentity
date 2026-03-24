/**
 * Assurance Data Access Layer
 *
 * Converts the unified verification model into assurance state.
 * Uses React.cache() for per-request deduplication in server components.
 */
import "server-only";

import type { Session } from "@/lib/auth/auth";
import type { UnifiedVerificationModel } from "@/lib/identity/verification/unified-model";
import type { AssuranceState } from "./types";

import { desc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db/connection";
import { hasPasskeyCredentials } from "@/lib/db/queries/passkey";
import { sessions } from "@/lib/db/schema/auth";
import { hasRequiredOcrProofTypes } from "@/lib/identity/verification/ocr-proof-sessions";
import { getUnifiedVerificationModel } from "@/lib/identity/verification/unified-model";

import { computeAssuranceState } from "./compute";

// ─── Unified model → AssuranceInput conversion ─────────────────────

function toAssuranceInput(
  model: UnifiedVerificationModel,
  loginMethod: string | null
) {
  const documentVerified = model.verifiedAt !== null;
  const chipVerified = model.method === "nfc_chip";
  const zkProofsComplete = hasRequiredOcrProofTypes(
    model.proofs.map((proof) => proof.proofType)
  );

  return {
    lastLoginMethod: loginMethod,
    hasSecuredKeys: model.bundle.fheKeyId !== null,
    chipVerified,
    documentVerified,
    livenessVerified: model.compliance.checks.livenessVerified,
    faceMatchVerified: model.compliance.checks.faceMatchVerified,
    zkProofsComplete,
    fheComplete: model.fhe.complete,
    onChainAttested: model.onChainAttested,
    missingProfileSecret:
      !model.vault.hasProfileSecret && (documentVerified || chipVerified),
    needsDocumentReprocessing: model.needsDocumentReprocessing,
  };
}

/**
 * Resolve login method: use stored value, or fall back to passkey check.
 */
async function resolveLoginMethod(
  storedLoginMethod: string | null,
  userId: string
): Promise<string | null> {
  if (storedLoginMethod) {
    return storedLoginMethod;
  }
  const hasPasskeys = await hasPasskeyCredentials(userId);
  return hasPasskeys ? "passkey" : null;
}

// ─── Exported functions ─────────────────────────────────────────────

/**
 * Get the complete assurance state for a user.
 */
export const getAssuranceState = cache(async function getAssuranceState(
  userId: string,
  session: Session | null
): Promise<AssuranceState> {
  const hasSession = !!session;
  const storedLoginMethod =
    (session?.session as { lastLoginMethod?: string } | undefined)
      ?.lastLoginMethod ?? null;

  const [model, loginMethod] = await Promise.all([
    getUnifiedVerificationModel(userId),
    resolveLoginMethod(storedLoginMethod, userId),
  ]);

  const data = toAssuranceInput(model, loginMethod);

  return computeAssuranceState({
    hasSession,
    loginMethod: data.lastLoginMethod,
    ...data,
  });
});

/**
 * Get assurance state for the OAuth token endpoint.
 *
 * Unlike getAssuranceState, this doesn't require a Session object.
 * Queries the latest session for lastLoginMethod directly.
 */
export async function getAssuranceForOAuth(
  userId: string
): Promise<AssuranceState & { authTime: number }> {
  const [latestSession, model] = await Promise.all([
    db
      .select({
        lastLoginMethod: sessions.lastLoginMethod,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(1)
      .get(),
    getUnifiedVerificationModel(userId),
  ]);

  const loginMethod = await resolveLoginMethod(
    latestSession?.lastLoginMethod ?? null,
    userId
  );
  const data = toAssuranceInput(model, loginMethod);

  const authTime = latestSession?.createdAt
    ? Math.floor(new Date(latestSession.createdAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    ...computeAssuranceState({
      hasSession: true,
      loginMethod: data.lastLoginMethod,
      ...data,
    }),
    authTime,
  };
}

/**
 * Get assurance state for unauthenticated users (Tier 0)
 */
export function getUnauthenticatedAssuranceState(): AssuranceState {
  return computeAssuranceState({
    hasSession: false,
    loginMethod: null,
    hasSecuredKeys: false,
    chipVerified: false,
    documentVerified: false,
    livenessVerified: false,
    faceMatchVerified: false,
    zkProofsComplete: false,
    fheComplete: false,
    onChainAttested: false,
    missingProfileSecret: false,
    needsDocumentReprocessing: false,
  });
}

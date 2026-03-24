/**
 * Verification check materialization engine.
 *
 * Materializes the 7 boolean compliance checks into the verification_checks
 * table. This is a cache of deriveComplianceStatus — the pure function remains
 * the source of truth.
 *
 * Idempotent: calling twice for the same verification produces the same rows.
 */

import type { ComplianceChecks } from "./compliance";

import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { getVerificationById, isChipVerified } from "@/lib/db/queries/identity";
import {
  proofArtifacts,
  signedClaims,
  verificationChecks,
} from "@/lib/db/schema/crypto";

import { deriveComplianceStatus } from "./compliance";

// ─── Check type constants ────────────────────────────────────────────

const CHECK_TYPES = [
  "document",
  "age",
  "liveness",
  "face_match",
  "nationality",
  "identity_binding",
  "sybil_resistant",
] as const;

type CheckType = (typeof CHECK_TYPES)[number];

const CHECK_TO_COMPLIANCE_KEY: Record<CheckType, keyof ComplianceChecks> = {
  document: "documentVerified",
  age: "ageVerified",
  liveness: "livenessVerified",
  face_match: "faceMatchVerified",
  nationality: "nationalityVerified",
  identity_binding: "identityBound",
  sybil_resistant: "sybilResistant",
};

// ─── Materialization ──────────────────────────────────────────────────

export async function materializeVerificationChecks(
  userId: string,
  verificationId: string
): Promise<void> {
  const verification = await getVerificationById(verificationId);
  if (!verification || verification.userId !== userId) {
    return;
  }

  // Fetch evidence in parallel
  const [proofRows, claimRows] = await Promise.all([
    db
      .select({
        id: proofArtifacts.id,
        proofType: proofArtifacts.proofType,
        verified: proofArtifacts.verified,
      })
      .from(proofArtifacts)
      .where(
        and(
          eq(proofArtifacts.userId, userId),
          eq(proofArtifacts.verificationId, verificationId),
          eq(proofArtifacts.verified, true)
        )
      )
      .all(),
    db
      .select({
        id: signedClaims.id,
        claimType: signedClaims.claimType,
      })
      .from(signedClaims)
      .where(
        and(
          eq(signedClaims.userId, userId),
          eq(signedClaims.verificationId, verificationId)
        )
      )
      .all(),
  ]);

  // Build compliance input and derive checks
  const claimTypes = claimRows.map((c) => ({ claimType: c.claimType }));
  const chipVerified = isChipVerified(verification);

  const result = deriveComplianceStatus({
    verificationMethod: chipVerified ? "nfc_chip" : "ocr",
    birthYearOffset: verification.birthYearOffset ?? null,
    zkProofs: proofRows.map((p) => ({
      proofType: p.proofType,
      verified: p.verified ?? false,
    })),
    signedClaims: claimTypes,
    encryptedAttributes: [],
    hasUniqueIdentifier: Boolean(
      verification.dedupKey || verification.uniqueIdentifier
    ),
    hasNationalityCommitment: Boolean(verification.nationalityCommitment),
  });

  // Build evidence index for lookups
  const proofByType = new Map(proofRows.map((p) => [p.proofType, p.id]));
  const claimByType = new Map(claimRows.map((c) => [c.claimType, c.id]));

  // Upsert all 7 checks
  for (const checkType of CHECK_TYPES) {
    const complianceKey = CHECK_TO_COMPLIANCE_KEY[checkType];
    const passed = result.checks[complianceKey];
    const evidence = chipVerified
      ? resolveNfcEvidence(checkType, verificationId, claimByType)
      : resolveOcrEvidence(checkType, verificationId, proofByType, claimByType);

    await db
      .insert(verificationChecks)
      .values({
        id: crypto.randomUUID(),
        userId,
        verificationId,
        checkType,
        passed,
        source: evidence.source,
        evidenceRef: evidence.ref,
      })
      .onConflictDoUpdate({
        target: [
          verificationChecks.verificationId,
          verificationChecks.checkType,
        ],
        set: {
          passed,
          source: evidence.source,
          evidenceRef: evidence.ref,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
  }
}

// ─── Evidence resolution ──────────────────────────────────────────────

interface Evidence {
  ref: string | null;
  source: string;
}

function resolveOcrEvidence(
  checkType: CheckType,
  verificationId: string,
  proofByType: Map<string, string>,
  claimByType: Map<string, string>
): Evidence {
  switch (checkType) {
    case "document":
      return {
        source: "zk_proof",
        ref: proofByType.get("doc_validity") ?? null,
      };
    case "age":
      return {
        source: "zk_proof",
        ref: proofByType.get("age_verification") ?? null,
      };
    case "face_match":
      return proofByType.has("face_match")
        ? { source: "zk_proof", ref: proofByType.get("face_match") ?? null }
        : {
            source: "signed_claim",
            ref: claimByType.get("face_match_score") ?? null,
          };
    case "nationality":
      return {
        source: "zk_proof",
        ref: proofByType.get("nationality_membership") ?? null,
      };
    case "identity_binding":
      return {
        source: "zk_proof",
        ref: proofByType.get("identity_binding") ?? null,
      };
    case "liveness":
      return {
        source: "signed_claim",
        ref: claimByType.get("liveness_score") ?? null,
      };
    case "sybil_resistant":
      return { source: "dedup_key", ref: verificationId };
    default:
      return { source: "unknown", ref: null };
  }
}

function resolveNfcEvidence(
  checkType: CheckType,
  verificationId: string,
  claimByType: Map<string, string>
): Evidence {
  const chipClaimId = claimByType.get("chip_verification") ?? null;

  switch (checkType) {
    case "document":
      return { source: "chip_claim", ref: verificationId };
    case "age":
    case "liveness":
    case "face_match":
      return { source: "chip_claim", ref: chipClaimId };
    case "nationality":
      return { source: "commitment", ref: verificationId };
    case "identity_binding":
    case "sybil_resistant":
      return { source: "nullifier", ref: verificationId };
    default:
      return { source: "unknown", ref: null };
  }
}

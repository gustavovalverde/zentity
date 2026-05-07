/**
 * Verification check materialization engine.
 *
 * Materializes the 7 boolean compliance checks into the verification_checks
 * table. This is a cache of deriveComplianceStatus — the pure function remains
 * the source of truth.
 *
 * Idempotent: calling twice for the same verification produces the same rows.
 */

import crypto from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import {
  getVerificationById,
  isChipVerified,
  resolveSybilResistanceEvidence,
} from "@/lib/db/queries/identity";
import { humanSignals } from "@/lib/db/schema/identity";
import {
  proofArtifacts,
  signedClaims,
  verificationChecks,
} from "@/lib/db/schema/privacy";

import {
  CHECK_TYPE_TO_COMPLIANCE_KEY,
  deriveComplianceStatus,
  VERIFICATION_CHECK_TYPES,
  type VerificationCheckType,
} from "./compliance";
import { selectLatestCompleteOcrProofRows } from "./ocr-completeness";

type VerificationMaterializationExecutor = Pick<
  typeof db,
  "insert" | "select" | "update"
>;

// ─── Materialization ──────────────────────────────────────────────────

export async function materializeVerificationChecks(
  userId: string,
  verificationId: string,
  executor: VerificationMaterializationExecutor = db
): Promise<void> {
  const verification = await getVerificationById(verificationId, executor);
  if (!verification || verification.userId !== userId) {
    return;
  }

  // Fetch evidence in parallel
  const [proofRows, claimRows, activeHumanSignal] = await Promise.all([
    executor
      .select({
        id: proofArtifacts.id,
        proofType: proofArtifacts.proofType,
        proofSessionId: proofArtifacts.proofSessionId,
        policyVersion: proofArtifacts.policyVersion,
        createdAt: proofArtifacts.createdAt,
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
    executor
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
    executor
      .select({ id: humanSignals.id })
      .from(humanSignals)
      .where(
        and(
          eq(humanSignals.userId, userId),
          eq(humanSignals.provider, "world_id"),
          isNull(humanSignals.revokedAt)
        )
      )
      .limit(1)
      .get(),
  ]);

  const humanSignalId = activeHumanSignal?.id ?? null;

  // Build compliance input and derive checks
  const claimTypes = claimRows.map((c) => ({ claimType: c.claimType }));
  const chipVerified = isChipVerified(verification);
  const selectedProofRows = chipVerified
    ? proofRows
    : selectLatestCompleteOcrProofRows(proofRows);

  const result = deriveComplianceStatus({
    verificationMethod: chipVerified ? "nfc_chip" : "ocr",
    birthYearOffset: verification.birthYearOffset ?? null,
    zkProofs: selectedProofRows.map((p) => ({
      proofType: p.proofType,
      verified: p.verified ?? false,
    })),
    signedClaims: claimTypes,
    hasDocumentSybilSignal: Boolean(
      verification.dedupKey || verification.chipNullifier
    ),
    hasHumanUniquenessSignal: Boolean(humanSignalId),
    hasNationalityCommitment: Boolean(verification.nationalityCommitment),
  });

  // Build evidence index for lookups
  const proofByType = new Map(
    selectedProofRows.map((proofRow) => [proofRow.proofType, proofRow.id])
  );
  const claimByType = new Map(claimRows.map((c) => [c.claimType, c.id]));

  // Upsert all 7 checks
  for (const checkType of VERIFICATION_CHECK_TYPES) {
    const complianceKey = CHECK_TYPE_TO_COMPLIANCE_KEY[checkType];
    const passed = result.checks[complianceKey];
    const evidence = chipVerified
      ? resolveNfcEvidence(checkType, verification, claimByType, humanSignalId)
      : resolveOcrEvidence(
          checkType,
          verification,
          proofByType,
          claimByType,
          humanSignalId
        );

    await executor
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
  checkType: VerificationCheckType,
  verification: NonNullable<Awaited<ReturnType<typeof getVerificationById>>>,
  proofByType: Map<string, string>,
  claimByType: Map<string, string>,
  humanSignalId: string | null
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
      return resolveSybilResistanceEvidence({
        hasDocumentSybilSignal: Boolean(
          verification.dedupKey || verification.chipNullifier
        ),
        humanSignalId,
        verificationId: verification.id,
      });
    default:
      return { source: "unknown", ref: null };
  }
}

function resolveNfcEvidence(
  checkType: VerificationCheckType,
  verification: NonNullable<Awaited<ReturnType<typeof getVerificationById>>>,
  claimByType: Map<string, string>,
  humanSignalId: string | null
): Evidence {
  const chipClaimId = claimByType.get("chip_verification") ?? null;

  switch (checkType) {
    case "document":
      return { source: "chip_claim", ref: verification.id };
    case "age":
    case "liveness":
    case "face_match":
      return { source: "chip_claim", ref: chipClaimId };
    case "nationality":
      return { source: "commitment", ref: verification.id };
    case "identity_binding":
    case "sybil_resistant":
      return resolveSybilResistanceEvidence({
        hasDocumentSybilSignal: Boolean(
          verification.dedupKey || verification.chipNullifier
        ),
        humanSignalId,
        verificationId: verification.id,
      });
    default:
      return { source: "unknown", ref: null };
  }
}

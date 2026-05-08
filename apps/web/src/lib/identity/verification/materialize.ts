/**
 * Verification check materialization engine.
 *
 * Materializes the 7 boolean compliance checks into the verification_checks
 * table. This is a cache of `deriveComplianceStatus` — the pure function
 * remains the source of truth.
 *
 * Idempotent: calling twice for the same verification produces the same rows.
 */

import crypto from "node:crypto";

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { listActiveHumanityCredentials } from "@/lib/db/queries/humanity";
import { getVerificationById, isChipVerified } from "@/lib/db/queries/identity";
import { identityVerifications } from "@/lib/db/schema/identity";
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
import { resolveSybilEvidence } from "./sybil-evidence";

type VerificationMaterializationExecutor = Pick<
  typeof db,
  "delete" | "insert" | "select" | "update"
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

  const [proofRows, claimRows, activeHumanity] = await Promise.all([
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
    listActiveHumanityCredentials(userId, executor),
  ]);
  const activeHumanityIds = activeHumanity.map((row) => row.id);

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
    hasHumanityCredential: activeHumanityIds.length > 0,
    hasNationalityCommitment: Boolean(verification.nationalityCommitment),
  });

  const proofByType = new Map(
    selectedProofRows.map((proofRow) => [proofRow.proofType, proofRow.id])
  );
  const claimByType = new Map(claimRows.map((c) => [c.claimType, c.id]));
  const updatedAt = new Date().toISOString();

  const rows = VERIFICATION_CHECK_TYPES.map((checkType) => {
    const evidence = chipVerified
      ? resolveNfcEvidence(
          checkType,
          verification,
          claimByType,
          activeHumanityIds
        )
      : resolveOcrEvidence(
          checkType,
          verification,
          proofByType,
          claimByType,
          activeHumanityIds
        );
    return {
      id: crypto.randomUUID(),
      userId,
      verificationId,
      checkType,
      passed: result.policy.checks[CHECK_TYPE_TO_COMPLIANCE_KEY[checkType]],
      source: evidence.source,
      evidenceRef: evidence.ref,
    };
  });

  await executor
    .insert(verificationChecks)
    .values(rows)
    .onConflictDoUpdate({
      target: [verificationChecks.verificationId, verificationChecks.checkType],
      set: {
        passed: sql`excluded.passed`,
        source: sql`excluded.source`,
        evidenceRef: sql`excluded.evidence_ref`,
        updatedAt,
      },
    })
    .run();
}

/**
 * Re-materialize every non-revoked verification owned by `userId`.
 *
 * Used by the humanity-credential attach/detach routes: changing the active
 * humanity-credential set affects only the `sybil_resistant` row, but the
 * cleanest invariant is "after a write, every materialized check for the
 * user is consistent with the source-of-truth derivation function." Callers
 * with no verifications get a no-op; the read model still surfaces humanity
 * via its own override.
 */
export async function rematerializeAllUserVerifications(
  userId: string,
  executor: VerificationMaterializationExecutor = db
): Promise<void> {
  const rows = await executor
    .select({ id: identityVerifications.id })
    .from(identityVerifications)
    .where(
      and(
        eq(identityVerifications.userId, userId),
        ne(identityVerifications.status, "revoked")
      )
    )
    .all();

  for (const row of rows) {
    await materializeVerificationChecks(userId, row.id, executor);
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
  activeHumanityIds: readonly string[]
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
      return resolveSybilEvidence({
        hasDocumentSybilSignal: Boolean(
          verification.dedupKey || verification.chipNullifier
        ),
        humanityCredentialIds: activeHumanityIds,
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
  activeHumanityIds: readonly string[]
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
      // Identity binding on chip path is established by the chip nullifier
      // itself, never by an external humanity credential. The evidence ref
      // points at the verification row that holds the nullifier.
      return verification.chipNullifier
        ? { source: "chip_nullifier", ref: verification.id }
        : { source: "none", ref: null };
    case "sybil_resistant":
      return resolveSybilEvidence({
        hasDocumentSybilSignal: Boolean(
          verification.dedupKey || verification.chipNullifier
        ),
        humanityCredentialIds: activeHumanityIds,
        verificationId: verification.id,
      });
    default:
      return { source: "unknown", ref: null };
  }
}

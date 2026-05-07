/**
 * Verification read model.
 *
 * Single function all consumers call to get a user's verification state.
 * Reads from the materialized verification_checks table plus supplementary
 * tables for bundle, FHE, vault, and attestation status.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db/connection";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import {
  getAccountIdentity,
  hasProfileSecret,
  isChipVerified,
} from "@/lib/db/queries/identity";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestSignedClaimByUserTypeAndVerification,
} from "@/lib/db/queries/privacy";
import { proofArtifacts, verificationChecks } from "@/lib/db/schema/privacy";

import {
  CHECK_TYPE_TO_COMPLIANCE_KEY,
  type ComplianceChecks,
  type ComplianceLevel,
  deriveLevelFromChecks,
  EMPTY_CHECKS,
  type VerificationCheckType,
} from "./compliance";
import { selectLatestCompleteOcrProofRows } from "./ocr-completeness";

// ─── Types ─────────────────────────────────────────────────────────

export interface VerificationCheck {
  checkType: string;
  evidenceRef: string | null;
  passed: boolean;
  source: string;
}

export interface ProofSummary {
  createdAt: string;
  proofHash: string;
  proofSystem: string;
  proofType: string;
  verified: boolean;
}

export interface GroupedIdentityCredential {
  credentialId: string;
  isEffective: boolean;
  method: "ocr" | "nfc_chip";
  status: "pending" | "verified" | "failed" | "revoked";
  supersededAt?: string | null;
  supersededByVerificationId?: string | null;
  verifiedAt: string | null;
}

export interface VerificationReadModel {
  bundle: {
    exists: boolean;
    fheKeyId: string | null;
    hasHumanSignal: boolean;
    policyVersion: string | null;
    attestationExpiresAt: string | null;
    verificationExpiresAt: string | null;
    updatedAt: string | null;
    validityStatus: "pending" | "verified" | "failed" | "revoked" | "stale";
  };

  checks: VerificationCheck[];

  compliance: {
    level: ComplianceLevel;
    numericLevel: number;
    verified: boolean;
    birthYearOffset: number | null;
    checks: ComplianceChecks;
  };

  fhe: {
    complete: boolean;
    attributeTypes: string[];
  };
  groupedIdentity: {
    effectiveVerificationId: string | null;
    credentials: GroupedIdentityCredential[];
  };
  issuerCountry: string | null;
  method: "ocr" | "nfc_chip" | null;
  needsDocumentReprocessing: boolean;

  onChainAttested: boolean;
  proofs: ProofSummary[];

  vault: {
    hasProfileSecret: boolean;
  };
  verificationId: string | null;
  verifiedAt: string | null;
}

// ─── FHE completeness (inlined to avoid circular dep with assurance) ─

function isFheComplete(attributeTypes: string[]): boolean {
  const hasDob =
    attributeTypes.includes("birth_year_offset") ||
    attributeTypes.includes("dob_days");
  const hasLiveness = attributeTypes.includes("liveness_score");
  return hasDob && hasLiveness;
}

// ─── Compliance derivation from materialized checks ────────────────

function deriveComplianceFromChecks(
  rows: VerificationCheck[],
  method: "ocr" | "nfc_chip",
  birthYearOffset: number | null,
  hasHumanSignal: boolean
): VerificationReadModel["compliance"] {
  const checks: ComplianceChecks = {
    ...EMPTY_CHECKS,
    sybilResistant: hasHumanSignal,
  };
  for (const row of rows) {
    const key =
      CHECK_TYPE_TO_COMPLIANCE_KEY[row.checkType as VerificationCheckType];
    if (key) {
      checks[key] = row.passed;
    }
  }
  checks.sybilResistant = checks.sybilResistant || hasHumanSignal;

  const { level, numericLevel, verified } = deriveLevelFromChecks(
    checks,
    method
  );

  return {
    level,
    numericLevel,
    verified,
    birthYearOffset,
    checks,
  };
}

// ─── DB queries ─────────────────────────────────────────────────────

async function getChecksByVerificationId(
  verificationId: string
): Promise<VerificationCheck[]> {
  return await db
    .select({
      checkType: verificationChecks.checkType,
      passed: verificationChecks.passed,
      source: verificationChecks.source,
      evidenceRef: verificationChecks.evidenceRef,
    })
    .from(verificationChecks)
    .where(eq(verificationChecks.verificationId, verificationId))
    .all();
}

async function getProofSummaries(
  userId: string,
  verificationId: string,
  method: "ocr" | "nfc_chip"
): Promise<ProofSummary[]> {
  const rows = await db
    .select({
      proofSystem: proofArtifacts.proofSystem,
      proofType: proofArtifacts.proofType,
      proofHash: proofArtifacts.proofHash,
      proofSessionId: proofArtifacts.proofSessionId,
      policyVersion: proofArtifacts.policyVersion,
      verified: proofArtifacts.verified,
      createdAt: proofArtifacts.createdAt,
    })
    .from(proofArtifacts)
    .where(
      and(
        eq(proofArtifacts.userId, userId),
        eq(proofArtifacts.verificationId, verificationId),
        eq(proofArtifacts.verified, true)
      )
    )
    .all();

  const selectedRows =
    method === "ocr" ? selectLatestCompleteOcrProofRows(rows) : rows;

  return selectedRows.map((r) => ({
    proofSystem: r.proofSystem,
    proofType: r.proofType,
    proofHash: r.proofHash,
    verified: r.verified ?? false,
    createdAt: r.createdAt,
  }));
}

async function hasConfirmedAttestation(userId: string): Promise<boolean> {
  const attestations = await getBlockchainAttestationsByUserId(userId);
  return attestations.some((a) => a.status === "confirmed");
}

interface OcrClaimData {
  claimHashes?: {
    age?: string | null;
    docValidity?: string | null;
    nationality?: string | null;
  };
}

async function checkNeedsReprocessing(
  userId: string,
  verificationId: string
): Promise<boolean> {
  const ocrClaim = await getLatestSignedClaimByUserTypeAndVerification(
    userId,
    "ocr_result",
    verificationId
  );

  if (!ocrClaim) {
    return false;
  }

  try {
    const payload = JSON.parse(ocrClaim.claimPayload) as OcrClaimData;
    const hashes = payload.claimHashes;
    return !(hashes?.age && hashes?.docValidity && hashes?.nationality);
  } catch {
    return true;
  }
}

// ─── Empty model ────────────────────────────────────────────────────

type BundleData = Awaited<ReturnType<typeof getAccountIdentity>>["bundle"];

function buildBundle(bundle: BundleData) {
  return {
    exists: bundle !== null,
    fheKeyId: bundle?.fheKeyId ?? null,
    hasHumanSignal: Boolean(bundle?.hasHumanSignal),
    policyVersion: bundle?.policyVersion ?? null,
    attestationExpiresAt: bundle?.attestationExpiresAt ?? null,
    verificationExpiresAt: bundle?.verificationExpiresAt ?? null,
    updatedAt: bundle?.updatedAt ?? null,
    validityStatus: bundle?.validityStatus ?? "pending",
  };
}

function isHumanSignalUsable(bundle: BundleData): boolean {
  return (
    Boolean(bundle?.hasHumanSignal) && bundle?.validityStatus !== "revoked"
  );
}

function gateVerifiedFlagByBundleValidity(
  compliance: VerificationReadModel["compliance"],
  bundle: BundleData
): VerificationReadModel["compliance"] {
  if (!bundle || bundle.validityStatus === "verified") {
    return compliance;
  }

  return {
    ...compliance,
    verified: false,
  };
}

function buildEmptyModel(
  bundle: BundleData,
  fheTypes: string[],
  profileExists: boolean,
  attested: boolean,
  groupedIdentity: VerificationReadModel["groupedIdentity"]
): VerificationReadModel {
  const checks = {
    ...EMPTY_CHECKS,
    sybilResistant: isHumanSignalUsable(bundle),
  };
  const { level, numericLevel, verified } = deriveLevelFromChecks(checks, null);

  return {
    method: null,
    verificationId: null,
    verifiedAt: null,
    issuerCountry: null,
    compliance: {
      level,
      numericLevel,
      verified,
      birthYearOffset: null,
      checks,
    },
    checks: [],
    proofs: [],
    bundle: buildBundle(bundle),
    fhe: { complete: isFheComplete(fheTypes), attributeTypes: fheTypes },
    vault: { hasProfileSecret: profileExists },
    onChainAttested: attested,
    needsDocumentReprocessing: false,
    groupedIdentity,
  };
}

function buildGroupedIdentity(
  accountIdentity: Awaited<ReturnType<typeof getAccountIdentity>>
): VerificationReadModel["groupedIdentity"] {
  const effectiveVerificationId =
    accountIdentity.effectiveVerification?.id ?? null;

  return {
    effectiveVerificationId,
    credentials: accountIdentity.groupedCredentials.map((credential) => ({
      credentialId: credential.id,
      method: credential.method,
      status: credential.status,
      supersededAt: credential.supersededAt ?? null,
      supersededByVerificationId: credential.supersededByVerificationId ?? null,
      verifiedAt: credential.verifiedAt ?? null,
      isEffective: credential.id === effectiveVerificationId,
    })),
  };
}

// ─── Main read function ─────────────────────────────────────────────

export const getVerificationReadModel = cache(
  async function getVerificationReadModel(
    userId: string
  ): Promise<VerificationReadModel> {
    // Batch 1: independent queries
    const [accountIdentity, fheTypes, profileExists, attested] =
      await Promise.all([
        getAccountIdentity(userId),
        getEncryptedAttributeTypesByUserId(userId),
        hasProfileSecret(userId),
        hasConfirmedAttestation(userId),
      ]);

    const verification = accountIdentity.effectiveVerification;
    const bundle = accountIdentity.bundle;
    const groupedIdentity = buildGroupedIdentity(accountIdentity);

    if (!verification) {
      return buildEmptyModel(
        bundle,
        fheTypes,
        profileExists,
        attested,
        groupedIdentity
      );
    }

    const verificationId = verification.id;
    const chipVerified = isChipVerified(verification);
    const method: "ocr" | "nfc_chip" = chipVerified ? "nfc_chip" : "ocr";

    // Batch 2: verification-dependent queries
    const secondBatch = [
      getChecksByVerificationId(verificationId),
      getProofSummaries(userId, verificationId, method),
    ] as const;
    // OCR-only: check if document needs reprocessing
    const reprocessPromise =
      method === "ocr"
        ? checkNeedsReprocessing(userId, verificationId)
        : Promise.resolve(false);

    const [checks, proofs, needsDocumentReprocessing] = await Promise.all([
      ...secondBatch,
      reprocessPromise,
    ]);

    const compliance = gateVerifiedFlagByBundleValidity(
      deriveComplianceFromChecks(
        checks,
        method,
        verification.birthYearOffset ?? null,
        isHumanSignalUsable(bundle)
      ),
      bundle
    );

    return {
      method,
      verificationId,
      verifiedAt: verification.verifiedAt ?? null,
      issuerCountry: verification.issuerCountry ?? null,
      compliance,
      checks,
      proofs,
      bundle: buildBundle(bundle),
      fhe: { complete: isFheComplete(fheTypes), attributeTypes: fheTypes },
      vault: { hasProfileSecret: profileExists },
      onChainAttested: attested,
      needsDocumentReprocessing:
        compliance.checks.documentVerified && needsDocumentReprocessing,
      groupedIdentity,
    };
  }
);

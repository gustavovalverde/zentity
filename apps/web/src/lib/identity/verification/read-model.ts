/**
 * Verification read model.
 *
 * Single function all consumers call to get a user's verification state.
 * Reads from the materialized verification_checks table plus supplementary
 * tables for bundle, FHE, vault, and attestation status.
 */
import "server-only";

import type { ComplianceChecks, ComplianceLevel } from "./compliance";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db/connection";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import {
  getIdentityBundleByUserId,
  getSelectedVerification,
  hasProfileSecret,
  isChipVerified,
} from "@/lib/db/queries/identity";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestSignedClaimByUserTypeAndVerification,
} from "@/lib/db/queries/privacy";
import { proofArtifacts, verificationChecks } from "@/lib/db/schema/privacy";

import { selectLatestCompleteOcrProofRows } from "./ocr-proof-sessions";

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

export interface VerificationReadModel {
  bundle: {
    exists: boolean;
    fheKeyId: string | null;
    policyVersion: string | null;
    attestationExpiresAt: string | null;
    updatedAt: string | null;
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

const LEVEL_NUMERIC: Record<ComplianceLevel, number> = {
  chip: 4,
  full: 3,
  basic: 2,
  none: 1,
};

const EMPTY_COMPLIANCE_CHECKS: ComplianceChecks = {
  documentVerified: false,
  livenessVerified: false,
  ageVerified: false,
  faceMatchVerified: false,
  nationalityVerified: false,
  identityBound: false,
  sybilResistant: false,
};

const CHECK_TYPE_TO_COMPLIANCE_KEY: Record<string, keyof ComplianceChecks> = {
  document: "documentVerified",
  age: "ageVerified",
  liveness: "livenessVerified",
  face_match: "faceMatchVerified",
  nationality: "nationalityVerified",
  identity_binding: "identityBound",
  sybil_resistant: "sybilResistant",
};

function deriveComplianceFromChecks(
  rows: VerificationCheck[],
  method: "ocr" | "nfc_chip",
  birthYearOffset: number | null
): VerificationReadModel["compliance"] {
  if (rows.length === 0) {
    return {
      level: "none",
      numericLevel: LEVEL_NUMERIC.none,
      verified: false,
      birthYearOffset,
      checks: EMPTY_COMPLIANCE_CHECKS,
    };
  }

  const checks: ComplianceChecks = { ...EMPTY_COMPLIANCE_CHECKS };
  for (const row of rows) {
    const key = CHECK_TYPE_TO_COMPLIANCE_KEY[row.checkType];
    if (key) {
      checks[key] = row.passed;
    }
  }

  const passedCount = rows.filter((r) => r.passed).length;
  const totalCount = 7;

  let level: ComplianceLevel;
  if (method === "nfc_chip" && checks.sybilResistant) {
    level = "chip";
  } else if (passedCount === totalCount) {
    level = "full";
  } else if (passedCount >= Math.ceil(totalCount / 2)) {
    level = "basic";
  } else {
    level = "none";
  }

  return {
    level,
    numericLevel: LEVEL_NUMERIC[level],
    verified: level === "full" || level === "chip",
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

type BundleData = Awaited<ReturnType<typeof getIdentityBundleByUserId>>;

function buildBundle(bundle: BundleData) {
  return {
    exists: bundle !== null,
    fheKeyId: bundle?.fheKeyId ?? null,
    policyVersion: bundle?.policyVersion ?? null,
    attestationExpiresAt: bundle?.attestationExpiresAt ?? null,
    updatedAt: bundle?.updatedAt ?? null,
  };
}

function buildEmptyModel(
  bundle: BundleData,
  fheTypes: string[],
  profileExists: boolean,
  attested: boolean
): VerificationReadModel {
  return {
    method: null,
    verificationId: null,
    verifiedAt: null,
    issuerCountry: null,
    compliance: {
      level: "none",
      numericLevel: LEVEL_NUMERIC.none,
      verified: false,
      birthYearOffset: null,
      checks: EMPTY_COMPLIANCE_CHECKS,
    },
    checks: [],
    proofs: [],
    bundle: buildBundle(bundle),
    fhe: { complete: isFheComplete(fheTypes), attributeTypes: fheTypes },
    vault: { hasProfileSecret: profileExists },
    onChainAttested: attested,
    needsDocumentReprocessing: false,
  };
}

// ─── Main read function ─────────────────────────────────────────────

export const getVerificationReadModel = cache(
  async function getVerificationReadModel(
    userId: string
  ): Promise<VerificationReadModel> {
    // Batch 1: independent queries
    const [verification, bundle, fheTypes, profileExists, attested] =
      await Promise.all([
        getSelectedVerification(userId),
        getIdentityBundleByUserId(userId),
        getEncryptedAttributeTypesByUserId(userId),
        hasProfileSecret(userId),
        hasConfirmedAttestation(userId),
      ]);

    if (!verification) {
      return buildEmptyModel(bundle, fheTypes, profileExists, attested);
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

    const compliance = deriveComplianceFromChecks(
      checks,
      method,
      verification.birthYearOffset ?? null
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
    };
  }
);

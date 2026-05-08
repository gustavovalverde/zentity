/**
 * Verification read model.
 *
 * Single function all consumers call to get a user's verification state.
 * Reads from the materialized verification_checks table plus supplementary
 * tables for bundle, FHE, vault, attestation, and humanity status.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db/connection";
import { getBlockchainAttestationsByUserId } from "@/lib/db/queries/attestation";
import { getActiveHumanityCredentials } from "@/lib/db/queries/humanity";
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
  type ComplianceResult,
  DEFAULT_POLICY_VERSION,
  deriveComplianceStatus,
  EMPTY_CHECKS,
  type IdentityEvidenceStrength,
  type VerificationCheckType,
  type VerificationMethod,
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

export interface HumanityCredentialSummary {
  attachedAt: string;
  expiresAt: string | null;
  provider: string;
  providerSubjectKind: string;
}

export interface VerificationReadModel {
  bundle: {
    exists: boolean;
    fheKeyId: string | null;
    policyVersion: string | null;
    attestationExpiresAt: string | null;
    verificationExpiresAt: string | null;
    updatedAt: string | null;
    validityStatus: "pending" | "verified" | "failed" | "revoked" | "stale";
  };

  checks: VerificationCheck[];

  compliance: ComplianceResult;

  fhe: {
    complete: boolean;
    attributeTypes: string[];
  };
  groupedIdentity: {
    effectiveVerificationId: string | null;
    credentials: GroupedIdentityCredential[];
  };
  /** Active humanity credentials for the user (provider list, no nullifiers). */
  humanityCredentials: HumanityCredentialSummary[];
  issuerCountry: string | null;
  method: VerificationMethod;
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
  hasHumanityCredential: boolean
): ComplianceResult {
  const checks: ComplianceChecks = {
    ...EMPTY_CHECKS,
    sybilResistant: hasHumanityCredential,
  };
  for (const row of rows) {
    const key =
      CHECK_TYPE_TO_COMPLIANCE_KEY[row.checkType as VerificationCheckType];
    if (key) {
      checks[key] = row.passed;
    }
  }
  checks.sybilResistant = checks.sybilResistant || hasHumanityCredential;

  const verified = method !== null && Object.values(checks).every(Boolean);

  return {
    identity: {
      verified,
      method,
      strength: deriveIdentityStrength(checks, method),
    },
    humanity: {
      proven: hasHumanityCredential,
    },
    policy: {
      version: DEFAULT_POLICY_VERSION,
      checks,
      birthYearOffset,
    },
  };
}

function deriveIdentityStrength(
  checks: ComplianceChecks,
  method: "ocr" | "nfc_chip"
): IdentityEvidenceStrength {
  if (method === "nfc_chip" && checks.documentVerified) {
    return "cryptographic_chip";
  }
  if (method === "ocr") {
    const corePassed =
      checks.documentVerified &&
      checks.livenessVerified &&
      checks.faceMatchVerified &&
      checks.ageVerified;
    if (corePassed) {
      return "documentary_full";
    }
    if (checks.documentVerified) {
      return "documentary";
    }
  }
  return "none";
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
    policyVersion: bundle?.policyVersion ?? null,
    attestationExpiresAt: bundle?.attestationExpiresAt ?? null,
    verificationExpiresAt: bundle?.verificationExpiresAt ?? null,
    updatedAt: bundle?.updatedAt ?? null,
    validityStatus: bundle?.validityStatus ?? "pending",
  };
}

function isHumanityUsable(hasActive: boolean, bundle: BundleData): boolean {
  return hasActive && bundle?.validityStatus !== "revoked";
}

function gateVerifiedFlagByBundleValidity(
  compliance: ComplianceResult,
  bundle: BundleData
): ComplianceResult {
  if (!bundle || bundle.validityStatus === "verified") {
    return compliance;
  }

  return {
    ...compliance,
    identity: {
      ...compliance.identity,
      verified: false,
    },
  };
}

function buildEmptyModel(args: {
  attested: boolean;
  bundle: BundleData;
  fheTypes: string[];
  groupedIdentity: VerificationReadModel["groupedIdentity"];
  humanityCredentials: HumanityCredentialSummary[];
  humanityUsable: boolean;
  profileExists: boolean;
}): VerificationReadModel {
  const compliance = deriveComplianceStatus({
    verificationMethod: null,
    birthYearOffset: null,
    zkProofs: [],
    signedClaims: [],
    hasDocumentSybilSignal: false,
    hasHumanityCredential: args.humanityUsable,
    hasNationalityCommitment: false,
  });

  return {
    method: null,
    verificationId: null,
    verifiedAt: null,
    issuerCountry: null,
    compliance,
    checks: [],
    proofs: [],
    bundle: buildBundle(args.bundle),
    fhe: {
      complete: isFheComplete(args.fheTypes),
      attributeTypes: args.fheTypes,
    },
    vault: { hasProfileSecret: args.profileExists },
    onChainAttested: args.attested,
    needsDocumentReprocessing: false,
    groupedIdentity: args.groupedIdentity,
    humanityCredentials: args.humanityCredentials,
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
    const [accountIdentity, fheTypes, profileExists, attested, humanityRows] =
      await Promise.all([
        getAccountIdentity(userId),
        getEncryptedAttributeTypesByUserId(userId),
        hasProfileSecret(userId),
        hasConfirmedAttestation(userId),
        getActiveHumanityCredentials(userId),
      ]);

    const verification = accountIdentity.effectiveVerification;
    const bundle = accountIdentity.bundle;
    const groupedIdentity = buildGroupedIdentity(accountIdentity);
    const humanityCredentials: HumanityCredentialSummary[] = humanityRows.map(
      (row) => ({
        provider: row.provider,
        providerSubjectKind: row.providerSubjectKind,
        attachedAt: row.attachedAt,
        expiresAt: row.expiresAt ?? null,
      })
    );
    const humanityUsable = isHumanityUsable(humanityRows.length > 0, bundle);

    if (!verification) {
      return buildEmptyModel({
        bundle,
        fheTypes,
        profileExists,
        attested,
        groupedIdentity,
        humanityCredentials,
        humanityUsable,
      });
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
        humanityUsable
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
        compliance.policy.checks.documentVerified && needsDocumentReprocessing,
      groupedIdentity,
      humanityCredentials,
    };
  }
);

/**
 * Convenience accessor for callers that only need the compliance projection.
 * Replaces the legacy `getComplianceStatus` and ensures a single source of
 * truth: there is no separate raw-query path.
 */
export const getComplianceStatus = cache(async function getComplianceStatus(
  userId: string
): Promise<ComplianceResult> {
  return (await getVerificationReadModel(userId)).compliance;
});

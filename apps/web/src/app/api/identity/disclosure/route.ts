/**
 * Identity Disclosure API for Regulated Entities
 *
 * This endpoint creates an encrypted disclosure package for relying parties
 * (banks, exchanges) that require actual PII for regulatory compliance.
 *
 * PRIVACY DESIGN:
 * - User must explicitly consent and initiate disclosure
 * - PII is decrypted client-side from the passkey-sealed profile
 * - Client re-encrypts to the RP (server never sees plaintext)
 * - ZK proofs (face match, age) are included but not encrypted
 *
 * USE CASE:
 * Crypto exchanges/banks need Name, DOB, Nationality for identity/AML compliance.
 * This enables that while:
 * 1. Protecting user privacy (E2E encryption)
 * 2. Providing cryptographic proofs (ZK)
 * 3. Minimizing Zentity's liability (no PII storage)
 */

import { createHash } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { requireSession } from "@/lib/auth/api-auth";
import {
  getAttestationEvidenceByUserAndDocument,
  recordAttestationConsent,
} from "@/lib/db/queries/attestation";
import {
  getLatestSignedClaimByUserTypeAndDocument,
  getLatestZkProofPayloadByUserAndType,
} from "@/lib/db/queries/crypto";
import {
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { createRequestLogger } from "@/lib/logging/logger";
import {
  attachRequestContextToSpan,
  getRequestLogBindings,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import {
  CIRCUIT_SPECS,
  parsePublicInputToNumber,
} from "@/lib/zk/zk-circuit-spec";

interface DisclosureRequest {
  // RP identification
  rpId: string;
  rpName?: string;
  // Client-generated metadata for auditability
  packageId?: string;
  createdAt?: string;
  expiresAt?: string;

  // Client-encrypted payload (passkey decrypt + re-encrypt to RP)
  encryptedPackage: string; // Base64 encoded

  // Explicit consent scope (fields approved by the user)
  scope: string[];
}

interface DisclosureResponse {
  success: boolean;
  packageId: string;

  // Encrypted PII package (only RP can decrypt)
  encryptedPackage?: string; // Base64 encoded

  // Encryption metadata
  encryptionMethod: string;
  encryptedFields: string[];

  // Verification proofs (public, not encrypted)
  proofs: {
    faceMatchProof?: {
      proof: string;
      publicSignals: string[];
      isMatch: boolean;
      threshold: number;
      thresholdScaled: number;
    };
    ageProof?: {
      proof: string;
      publicSignals: string[];
      isOver18: boolean;
      minAge: number;
      currentYear: number;
    };
    docValidityProof?: {
      proof: string;
      publicSignals: string[];
      isValid: boolean;
      currentDate: number;
    };
    nationalityProof?: {
      proof: string;
      publicSignals: string[];
      isMember: boolean;
      groupRoot: string;
    };
    livenessAttestation?: {
      verified: boolean;
      timestamp: string;
      method: string;
    };
  };

  // Signed claims for auditability (JWT signature + canonical payload)
  signedClaims?: {
    ocr?: { payload: string; signature: string; issuedAt: string };
    liveness?: { payload: string; signature: string; issuedAt: string };
    faceMatch?: { payload: string; signature: string; issuedAt: string };
  };

  evidence?: {
    policyVersion: string | null;
    policyHash: string | null;
    proofSetHash: string | null;
    consentReceipt?: string | null;
    consentReceiptHash?: string | null;
    consentScope?: string[] | null;
    consentedAt?: string | null;
    consentRpId?: string | null;
  } | null;

  // Document binding metadata
  documentHash?: string | null;

  // Package metadata
  createdAt: string;
  expiresAt: string;

  // Status
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<DisclosureResponse>> {
  const requestContext = await resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const log = createRequestLogger(
    requestContext.requestId,
    getRequestLogBindings(requestContext)
  );
  const fallbackPackageId = uuidv4();
  const fallbackCreatedAt = new Date().toISOString();
  const fallbackExpiresAt = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString(); // 24 hours
  let packageId = fallbackPackageId;
  let createdAt = fallbackCreatedAt;
  let expiresAt = fallbackExpiresAt;

  try {
    const authResult = await requireSession();
    if (!authResult.ok) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "Authentication required",
        },
        { status: 401 }
      );
    }

    const userId = authResult.session.user.id;

    // Check if user is verified
    const verificationStatus = await getVerificationStatus(userId);
    if (!verificationStatus.verified) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "User must complete identity verification before disclosure",
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as DisclosureRequest;
    packageId = body.packageId ?? fallbackPackageId;
    createdAt = body.createdAt ?? fallbackCreatedAt;
    expiresAt = body.expiresAt ?? fallbackExpiresAt;

    // Validate required fields
    if (!(body.rpId && body.encryptedPackage)) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "RP ID and encrypted package are required",
        },
        { status: 400 }
      );
    }

    if (!body.scope || body.scope.length === 0) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "Consent scope is required for disclosure",
        },
        { status: 400 }
      );
    }

    // Get existing identity document for document binding
    const identityDocument = await getSelectedIdentityDocumentByUserId(userId);
    if (!identityDocument) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error:
            "Identity document is missing required metadata. Please re-run verification.",
        },
        { status: 409 }
      );
    }

    const documentHash = identityDocument.documentHash ?? null;

    // =========================================================================
    // STEP 2: Load verified proofs bound to the stored document
    // =========================================================================
    const documentId = identityDocument.id;
    const proofs: DisclosureResponse["proofs"] = {};

    const ageProofPayload = await getLatestZkProofPayloadByUserAndType(
      userId,
      "age_verification",
      documentId
    );
    if (ageProofPayload) {
      const currentYear = parsePublicInputToNumber(
        ageProofPayload.publicSignals[0]
      );
      const minAge = parsePublicInputToNumber(ageProofPayload.publicSignals[1]);
      const isOver18 =
        parsePublicInputToNumber(
          ageProofPayload.publicSignals[
            CIRCUIT_SPECS.age_verification.resultIndex
          ]
        ) === 1;
      proofs.ageProof = {
        proof: ageProofPayload.proof,
        publicSignals: ageProofPayload.publicSignals,
        isOver18,
        minAge,
        currentYear,
      };
    }

    const docValidityPayload = await getLatestZkProofPayloadByUserAndType(
      userId,
      "doc_validity",
      documentId
    );
    if (docValidityPayload) {
      const currentDate = parsePublicInputToNumber(
        docValidityPayload.publicSignals[0]
      );
      const isValid =
        parsePublicInputToNumber(
          docValidityPayload.publicSignals[
            CIRCUIT_SPECS.doc_validity.resultIndex
          ]
        ) === 1;
      proofs.docValidityProof = {
        proof: docValidityPayload.proof,
        publicSignals: docValidityPayload.publicSignals,
        isValid,
        currentDate,
      };
    }

    const nationalityPayload = await getLatestZkProofPayloadByUserAndType(
      userId,
      "nationality_membership",
      documentId
    );
    if (nationalityPayload) {
      const groupRoot = nationalityPayload.publicSignals[0];
      const isMember =
        parsePublicInputToNumber(
          nationalityPayload.publicSignals[
            CIRCUIT_SPECS.nationality_membership.resultIndex
          ]
        ) === 1;
      proofs.nationalityProof = {
        proof: nationalityPayload.proof,
        publicSignals: nationalityPayload.publicSignals,
        isMember,
        groupRoot,
      };
    }

    const faceMatchPayload = await getLatestZkProofPayloadByUserAndType(
      userId,
      "face_match",
      documentId
    );
    if (faceMatchPayload) {
      const thresholdScaled = parsePublicInputToNumber(
        faceMatchPayload.publicSignals[0]
      );
      const isMatch =
        parsePublicInputToNumber(
          faceMatchPayload.publicSignals[CIRCUIT_SPECS.face_match.resultIndex]
        ) === 1;
      proofs.faceMatchProof = {
        proof: faceMatchPayload.proof,
        publicSignals: faceMatchPayload.publicSignals,
        isMatch,
        thresholdScaled,
        threshold: thresholdScaled / 10_000,
      };
    }

    const encryptedFields = body.scope;

    // =========================================================================
    // STEP 4: Build response with proofs + signed claims
    // =========================================================================
    const signedClaims: DisclosureResponse["signedClaims"] = {};

    const livenessClaim = await getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "liveness_score",
      documentId
    );
    if (livenessClaim?.signature && livenessClaim.claimPayload) {
      signedClaims.liveness = {
        payload: livenessClaim.claimPayload,
        signature: livenessClaim.signature,
        issuedAt: livenessClaim.issuedAt || createdAt,
      };

      let passed = true;
      try {
        const payload = JSON.parse(livenessClaim.claimPayload) as {
          data?: { passed?: boolean };
        };
        if (payload?.data?.passed === false) {
          passed = false;
        }
      } catch {
        /* JSON parse failed, use default passed=true */
      }

      if (passed) {
        proofs.livenessAttestation = {
          verified: true,
          timestamp: livenessClaim.issuedAt || createdAt,
          method: "signed_claim",
        };
      }
    }

    const faceMatchClaim = await getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "face_match_score",
      documentId
    );
    if (faceMatchClaim?.signature && faceMatchClaim.claimPayload) {
      signedClaims.faceMatch = {
        payload: faceMatchClaim.claimPayload,
        signature: faceMatchClaim.signature,
        issuedAt: faceMatchClaim.issuedAt || createdAt,
      };
    }

    const ocrClaim = await getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "ocr_result",
      documentId
    );
    if (ocrClaim?.signature && ocrClaim.claimPayload) {
      signedClaims.ocr = {
        payload: ocrClaim.claimPayload,
        signature: ocrClaim.signature,
        issuedAt: ocrClaim.issuedAt || createdAt,
      };
    }

    const consentReceipt = {
      version: 1,
      rpId: body.rpId,
      rpName: body.rpName ?? null,
      scope: encryptedFields,
      packageId,
      documentId,
      issuedAt: createdAt,
      expiresAt,
    };
    const consentReceiptJson = JSON.stringify(consentReceipt);
    const consentReceiptHash = createHash("sha256")
      .update(consentReceiptJson)
      .digest("hex");

    await recordAttestationConsent({
      userId,
      documentId,
      consentReceipt: consentReceiptJson,
      consentScope: JSON.stringify(encryptedFields),
      consentedAt: createdAt,
      consentRpId: body.rpId,
    });

    const signedClaimsPayload =
      signedClaims && Object.keys(signedClaims).length > 0
        ? signedClaims
        : undefined;
    const evidence =
      documentId && verificationStatus.verified
        ? await getAttestationEvidenceByUserAndDocument(userId, documentId)
        : null;
    const evidencePayload = {
      policyVersion: evidence?.policyVersion ?? null,
      policyHash: evidence?.policyHash ?? null,
      proofSetHash: evidence?.proofSetHash ?? null,
      consentReceipt: evidence?.consentReceipt ?? consentReceiptJson,
      consentReceiptHash,
      consentScope: encryptedFields,
      consentedAt: createdAt,
      consentRpId: body.rpId,
    };

    return NextResponse.json({
      success: true,
      packageId,
      encryptedPackage: body.encryptedPackage,
      encryptionMethod: "client-side: RSA-OAEP+AES-GCM-256",
      encryptedFields,
      proofs,
      signedClaims: signedClaimsPayload,
      evidence: evidencePayload,
      documentHash,
      createdAt,
      expiresAt,
    });
  } catch (error) {
    log.error(
      {
        path: "/api/identity/disclosure",
        error: error instanceof Error ? error.message : String(error),
      },
      "Identity disclosure failed"
    );
    return NextResponse.json(
      {
        success: false,
        packageId,
        encryptionMethod: "none",
        encryptedFields: [],
        proofs: {},
        createdAt,
        expiresAt,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}

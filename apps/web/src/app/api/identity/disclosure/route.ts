/**
 * Identity Disclosure API for Regulated Entities
 *
 * This endpoint creates an encrypted disclosure package for relying parties
 * (banks, exchanges) that require actual PII for regulatory compliance.
 *
 * PRIVACY DESIGN:
 * - User must explicitly consent and initiate disclosure
 * - PII is extracted fresh from document (not stored)
 * - PII is encrypted end-to-end to RP's public key
 * - Zentity never sees unencrypted PII after extraction
 * - ZK proofs (face match, age) are included but not encrypted
 *
 * USE CASE:
 * Crypto exchanges/banks need Name, DOB, Nationality for identity/AML compliance.
 * This enables that while:
 * 1. Protecting user privacy (E2E encryption)
 * 2. Providing cryptographic proofs (ZK)
 * 3. Minimizing Zentity's liability (no PII storage)
 */

import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { requireSession } from "@/lib/auth/api-auth";
import { decryptUserSalt } from "@/lib/crypto/pii-encryption";
import { getAttestationEvidenceByUserAndDocument } from "@/lib/db/queries/attestation";
import {
  getLatestSignedClaimByUserTypeAndDocument,
  getLatestZkProofPayloadByUserAndType,
} from "@/lib/db/queries/crypto";
import {
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { processDocumentOcr } from "@/lib/document/ocr-client";
import { toServiceErrorPayload } from "@/lib/utils/http-error-payload";
import { CIRCUIT_SPECS, parsePublicInputToNumber } from "@/lib/zk";

interface DisclosureRequest {
  // RP identification
  rpId: string;
  rpName?: string;
  rpPublicKey: string; // Base64 encoded RSA public key (SPKI format)

  // Document for fresh PII extraction
  documentImage: string;

  // Fields to include in disclosure
  fields: {
    fullName?: boolean;
    dateOfBirth?: boolean;
    nationality?: boolean;
    documentType?: boolean;
    documentNumber?: boolean;
  };
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
    faceMatch?: {
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
  } | null;

  // Document binding metadata
  documentHash?: string | null;

  // Package metadata
  createdAt: string;
  expiresAt: string;

  // Status
  error?: string;
}

/**
 * Encrypt data to RP's public key using RSA-OAEP
 * For larger payloads, uses hybrid encryption (RSA + AES-GCM)
 */
async function encryptToPublicKey(
  data: string,
  publicKeyBase64: string,
): Promise<string> {
  // Decode the public key
  const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");

  // Import the public key
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );

  // For hybrid encryption: generate AES key, encrypt data with AES, encrypt AES key with RSA
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );

  // Encrypt data with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dataBuffer = new TextEncoder().encode(data);
  const encryptedData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    dataBuffer,
  );

  // Export and encrypt AES key with RSA
  const aesKeyRaw = await crypto.subtle.exportKey("raw", aesKey);
  const encryptedAesKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    aesKeyRaw,
  );

  // Combine: encryptedAesKey (256 bytes for 2048-bit RSA) + iv (12 bytes) + encryptedData
  const result = new Uint8Array(
    encryptedAesKey.byteLength + iv.byteLength + encryptedData.byteLength,
  );
  result.set(new Uint8Array(encryptedAesKey), 0);
  result.set(iv, encryptedAesKey.byteLength);
  result.set(
    new Uint8Array(encryptedData),
    encryptedAesKey.byteLength + iv.byteLength,
  );

  return Buffer.from(result).toString("base64");
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DisclosureResponse>> {
  const packageId = uuidv4();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

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
        { status: 401 },
      );
    }

    const userId = authResult.session.user.id;

    // Check if user is verified
    const verificationStatus = getVerificationStatus(userId);
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
        { status: 403 },
      );
    }

    const body = (await request.json()) as DisclosureRequest;

    // Validate required fields
    if (!body.rpId || !body.rpPublicKey) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "RP ID and public key are required",
        },
        { status: 400 },
      );
    }

    if (!body.documentImage) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "Document image is required for disclosure",
        },
        { status: 400 },
      );
    }

    // Get existing identity document for user salt + document binding
    const identityDocument = getSelectedIdentityDocumentByUserId(userId);
    if (!identityDocument?.userSalt) {
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
            "Identity document is missing required cryptographic metadata. Please re-run verification.",
        },
        { status: 409 },
      );
    }

    const decryptedSalt = await decryptUserSalt(identityDocument.userSalt);
    if (!decryptedSalt) {
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
            "Unable to decrypt identity commitments. Please re-run verification.",
        },
        { status: 409 },
      );
    }

    // =========================================================================
    // STEP 1: Extract PII from document
    // =========================================================================
    let documentResult: {
      extractedData?: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        documentNumber?: string;
        dateOfBirth?: string;
        nationality?: string;
        nationalityCode?: string;
      };
      commitments?: {
        documentHash?: string | null;
      };
      documentType?: string;
      documentOrigin?: string;
    } | null = null;

    const requestId =
      request.headers.get("x-request-id") ||
      request.headers.get("x-correlation-id") ||
      undefined;

    try {
      documentResult = await processDocumentOcr({
        image: body.documentImage,
        userSalt: decryptedSalt,
        requestId,
      });
    } catch (error) {
      const { status } = toServiceErrorPayload(
        error,
        "Failed to process document",
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
          error: "Failed to process document",
        },
        { status },
      );
    }

    const documentHash = documentResult?.commitments?.documentHash ?? null;
    if (!documentHash || !identityDocument.documentHash) {
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
            "Unable to validate document commitments. Please re-run verification.",
        },
        { status: 409 },
      );
    }

    if (documentHash !== identityDocument.documentHash) {
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
            "Provided document does not match the verified identity record.",
        },
        { status: 403 },
      );
    }

    // =========================================================================
    // STEP 2: Load verified proofs bound to the stored document
    // =========================================================================
    const documentId = identityDocument.id;
    const proofs: DisclosureResponse["proofs"] = {};

    const ageProofPayload = getLatestZkProofPayloadByUserAndType(
      userId,
      "age_verification",
      documentId,
    );
    if (ageProofPayload) {
      const currentYear = parsePublicInputToNumber(
        ageProofPayload.publicSignals[0],
      );
      const minAge = parsePublicInputToNumber(ageProofPayload.publicSignals[1]);
      const isOver18 =
        parsePublicInputToNumber(
          ageProofPayload.publicSignals[
            CIRCUIT_SPECS.age_verification.resultIndex
          ],
        ) === 1;
      proofs.ageProof = {
        proof: ageProofPayload.proof,
        publicSignals: ageProofPayload.publicSignals,
        isOver18,
        minAge,
        currentYear,
      };
    }

    const docValidityPayload = getLatestZkProofPayloadByUserAndType(
      userId,
      "doc_validity",
      documentId,
    );
    if (docValidityPayload) {
      const currentDate = parsePublicInputToNumber(
        docValidityPayload.publicSignals[0],
      );
      const isValid =
        parsePublicInputToNumber(
          docValidityPayload.publicSignals[
            CIRCUIT_SPECS.doc_validity.resultIndex
          ],
        ) === 1;
      proofs.docValidityProof = {
        proof: docValidityPayload.proof,
        publicSignals: docValidityPayload.publicSignals,
        isValid,
        currentDate,
      };
    }

    const nationalityPayload = getLatestZkProofPayloadByUserAndType(
      userId,
      "nationality_membership",
      documentId,
    );
    if (nationalityPayload) {
      const groupRoot = nationalityPayload.publicSignals[0];
      const isMember =
        parsePublicInputToNumber(
          nationalityPayload.publicSignals[
            CIRCUIT_SPECS.nationality_membership.resultIndex
          ],
        ) === 1;
      proofs.nationalityProof = {
        proof: nationalityPayload.proof,
        publicSignals: nationalityPayload.publicSignals,
        isMember,
        groupRoot,
      };
    }

    const faceMatchPayload = getLatestZkProofPayloadByUserAndType(
      userId,
      "face_match",
      documentId,
    );
    if (faceMatchPayload) {
      const thresholdScaled = parsePublicInputToNumber(
        faceMatchPayload.publicSignals[0],
      );
      const isMatch =
        parsePublicInputToNumber(
          faceMatchPayload.publicSignals[CIRCUIT_SPECS.face_match.resultIndex],
        ) === 1;
      proofs.faceMatch = {
        proof: faceMatchPayload.proof,
        publicSignals: faceMatchPayload.publicSignals,
        isMatch,
        thresholdScaled,
        threshold: thresholdScaled / 10000,
      };
    }

    // =========================================================================
    // STEP 3: Build and encrypt PII package
    // =========================================================================
    const piiPackage: Record<string, string | undefined> = {};
    const encryptedFields: string[] = [];

    if (body.fields.fullName && documentResult?.extractedData?.fullName) {
      piiPackage.fullName = documentResult.extractedData.fullName;
      encryptedFields.push("fullName");
    }

    if (body.fields.dateOfBirth && documentResult?.extractedData?.dateOfBirth) {
      piiPackage.dateOfBirth = documentResult.extractedData.dateOfBirth;
      encryptedFields.push("dateOfBirth");
    }

    if (body.fields.nationality) {
      // Use nationality from extracted data or document origin
      piiPackage.nationality =
        documentResult?.extractedData?.nationality ||
        documentResult?.extractedData?.nationalityCode ||
        documentResult?.documentOrigin;
      if (piiPackage.nationality) encryptedFields.push("nationality");
    }

    if (body.fields.documentType && documentResult?.documentType) {
      piiPackage.documentType = documentResult.documentType;
      encryptedFields.push("documentType");
    }

    if (
      body.fields.documentNumber &&
      documentResult?.extractedData?.documentNumber
    ) {
      piiPackage.documentNumber = documentResult.extractedData.documentNumber;
      encryptedFields.push("documentNumber");
    }

    // Add metadata to package
    const fullPackage = {
      ...piiPackage,
      zentityUserId: userId,
      packageId,
      rpId: body.rpId,
      createdAt,
      expiresAt,
    };

    // Encrypt the package
    let encryptedPackage: string;
    try {
      encryptedPackage = await encryptToPublicKey(
        JSON.stringify(fullPackage),
        body.rpPublicKey,
      );
    } catch (_error) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "Failed to encrypt disclosure package. Invalid RP public key?",
        },
        { status: 400 },
      );
    }

    // =========================================================================
    // STEP 4: Build response with proofs + signed claims
    // =========================================================================
    const signedClaims: DisclosureResponse["signedClaims"] = {};

    const livenessClaim = getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "liveness_score",
      documentId,
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
      } catch {}

      if (passed) {
        proofs.livenessAttestation = {
          verified: true,
          timestamp: livenessClaim.issuedAt || createdAt,
          method: "signed_claim",
        };
      }
    }

    const faceMatchClaim = getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "face_match_score",
      documentId,
    );
    if (faceMatchClaim?.signature && faceMatchClaim.claimPayload) {
      signedClaims.faceMatch = {
        payload: faceMatchClaim.claimPayload,
        signature: faceMatchClaim.signature,
        issuedAt: faceMatchClaim.issuedAt || createdAt,
      };
    }

    const ocrClaim = getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "ocr_result",
      documentId,
    );
    if (ocrClaim?.signature && ocrClaim.claimPayload) {
      signedClaims.ocr = {
        payload: ocrClaim.claimPayload,
        signature: ocrClaim.signature,
        issuedAt: ocrClaim.issuedAt || createdAt,
      };
    }

    // PII has been extracted, encrypted, and is being returned
    // Document image is NOT stored - only transmitted to OCR service transiently
    // Encrypted package can only be decrypted by RP

    const signedClaimsPayload =
      signedClaims && Object.keys(signedClaims).length > 0
        ? signedClaims
        : undefined;
    const evidence =
      documentId && verificationStatus.verified
        ? getAttestationEvidenceByUserAndDocument(userId, documentId)
        : null;

    return NextResponse.json({
      success: true,
      packageId,
      encryptedPackage,
      encryptionMethod: "RSA-OAEP+AES-GCM-256",
      encryptedFields,
      proofs,
      signedClaims: signedClaimsPayload,
      evidence: evidence
        ? {
            policyVersion: evidence.policyVersion,
            policyHash: evidence.policyHash,
            proofSetHash: evidence.proofSetHash,
          }
        : null,
      documentHash,
      createdAt,
      expiresAt,
    });
  } catch (error) {
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
      { status: 500 },
    );
  }
}

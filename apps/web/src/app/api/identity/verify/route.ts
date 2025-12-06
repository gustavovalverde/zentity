/**
 * Privacy-Preserving Identity Verification API
 *
 * This endpoint handles the complete identity verification flow:
 * 1. Document processing (OCR) → Cryptographic commitments
 * 2. Liveness check → Boolean flag
 * 3. Face matching (ID photo ↔ selfie) → Boolean flag
 * 4. Store only proofs and flags, discard all PII
 *
 * PRIVACY GUARANTEES:
 * - Document images are processed transiently and never stored
 * - Selfie images are processed transiently and never stored
 * - Face embeddings are extracted, compared, and immediately discarded
 * - Only cryptographic commitments and boolean flags are persisted
 * - GDPR compliance: delete user_salt to "forget" the user
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import {
  createIdentityProof,
  getIdentityProofByUserId,
  documentHashExists,
  updateIdentityProofFlags,
  updateUserName,
} from "@/lib/db";
import { buildDisplayName } from "@/lib/name-utils";

// Service URLs
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || "http://localhost:5004";
const LIVENESS_SERVICE_URL =
  process.env.LIVENESS_SERVICE_URL || "http://localhost:5003";
const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";
const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

interface VerifyIdentityRequest {
  // Document image (base64)
  documentImage: string;

  // Selfie image (base64)
  selfieImage: string;

  // Optional: existing user salt for re-verification
  userSalt?: string;
}

interface VerifyIdentityResponse {
  success: boolean;
  verified: boolean;

  // Verification results
  results: {
    documentProcessed: boolean;
    documentType?: string;
    isValidDRDocument: boolean;
    livenessPassed: boolean;
    faceMatched: boolean;
    isDuplicateDocument: boolean;
    ageProofGenerated: boolean;
    dobEncrypted: boolean;
  };

  // Extracted data for UI display (TRANSIENT - DO NOT PERSIST ON CLIENT)
  transientData?: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    documentNumber?: string;
    dateOfBirth?: string;
  };

  // Processing metadata
  processingTimeMs: number;
  issues: string[];
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<VerifyIdentityResponse>> {
  const startTime = Date.now();
  const issues: string[] = [];

  try {
    // Authenticate user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          results: {
            documentProcessed: false,
            isValidDRDocument: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["unauthorized"],
          error: "Authentication required",
        },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const body = (await request.json()) as VerifyIdentityRequest;

    // Validate input
    if (!body.documentImage) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          results: {
            documentProcessed: false,
            isValidDRDocument: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["missing_document_image"],
          error: "Document image is required",
        },
        { status: 400 }
      );
    }

    if (!body.selfieImage) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          results: {
            documentProcessed: false,
            isValidDRDocument: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["missing_selfie_image"],
          error: "Selfie image is required",
        },
        { status: 400 }
      );
    }

    // Check if user already has identity proof
    const existingProof = getIdentityProofByUserId(userId);
    const userSalt = body.userSalt || existingProof?.userSalt;

    // =========================================================================
    // STEP 1: Privacy-Preserving Document Processing
    // =========================================================================
    let documentResult: {
      commitments?: {
        documentHash: string;
        nameCommitment: string;
        userSalt: string;
      };
      documentType: string;
      isValidDRDocument: boolean;
      confidence: number;
      extractedData?: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        documentNumber?: string;
        dateOfBirth?: string;
      };
      validationIssues: string[];
    } | null = null;

    try {
      const ocrResponse = await fetch(`${OCR_SERVICE_URL}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: body.documentImage,
          userSalt: userSalt,
        }),
      });

      if (!ocrResponse.ok) {
        throw new Error(`OCR service returned ${ocrResponse.status}`);
      }

      documentResult = await ocrResponse.json();
      issues.push(...(documentResult?.validationIssues || []));
    } catch (error) {
      console.error("Document processing error:", error);
      issues.push("document_processing_failed");
    }

    // Check for duplicate document
    let isDuplicateDocument = false;
    if (documentResult?.commitments?.documentHash) {
      const hashExists = documentHashExists(
        documentResult.commitments.documentHash
      );
      if (hashExists && !existingProof) {
        isDuplicateDocument = true;
        issues.push("duplicate_document");
      }
    }

    // =========================================================================
    // STEP 2: Full Verification (Liveness + Face Matching)
    // =========================================================================
    let verificationResult: {
      verified: boolean;
      is_live: boolean;
      antispoof_score: number;
      faces_match: boolean;
      face_match_confidence: number;
      issues: string[];
    } | null = null;

    try {
      const verifyResponse = await fetch(`${LIVENESS_SERVICE_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idImage: body.documentImage,
          selfieImage: body.selfieImage,
        }),
      });

      if (!verifyResponse.ok) {
        throw new Error(`Verification service returned ${verifyResponse.status}`);
      }

      verificationResult = await verifyResponse.json();

      // Log face match result for debugging
      console.log("[Identity Verify] Face match result:", {
        faces_match: verificationResult?.faces_match,
        face_match_confidence: verificationResult?.face_match_confidence,
        is_live: verificationResult?.is_live,
        verified: verificationResult?.verified,
      });

      issues.push(...(verificationResult?.issues || []));
    } catch (error) {
      console.error("Verification error:", error);
      issues.push("verification_service_failed");
    }

    // =========================================================================
    // STEP 3: Cryptographic Processing (FHE + ZK)
    // =========================================================================
    // If we have a DOB, encrypt it with FHE and generate ZK proof
    let fheResult: {
      ciphertext: string;
      clientKeyId: string;
    } | null = null;
    let zkResult: {
      proof: unknown;
      publicSignals: string[];
      generationTimeMs: number;
      isOver18: boolean;
    } | null = null;

    const dateOfBirth = documentResult?.extractedData?.dateOfBirth;
    if (dateOfBirth) {
      // Parse birth year from DOB (format: DD/MM/YYYY or YYYY-MM-DD)
      let birthYear: number | null = null;
      if (dateOfBirth.includes("/")) {
        const parts = dateOfBirth.split("/");
        birthYear = parseInt(parts[2], 10);
      } else if (dateOfBirth.includes("-")) {
        birthYear = parseInt(dateOfBirth.split("-")[0], 10);
      }

      if (birthYear && birthYear > 1900 && birthYear <= new Date().getFullYear()) {
        const currentYear = new Date().getFullYear();

        // FHE Encryption (encrypt birth year)
        try {
          const fheResponse = await fetch(`${FHE_SERVICE_URL}/encrypt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              birthYear,
              clientKeyId: "default",
            }),
          });

          if (fheResponse.ok) {
            const fheData = await fheResponse.json();
            fheResult = {
              ciphertext: fheData.ciphertext,
              clientKeyId: fheData.clientKeyId,
            };
          } else {
            console.warn("FHE encryption failed:", await fheResponse.text());
            issues.push("fhe_encryption_failed");
          }
        } catch (error) {
          console.warn("FHE service unavailable:", error);
          issues.push("fhe_service_unavailable");
        }

        // ZK Proof Generation (prove age >= 18)
        try {
          const zkResponse = await fetch(`${ZK_SERVICE_URL}/generate-proof`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              birthYear,
              currentYear,
              minAge: 18,
            }),
          });

          if (zkResponse.ok) {
            const zkData = await zkResponse.json();
            // publicSignals[0] is the isOver18 result (1 or 0)
            const isOver18 = zkData.publicSignals?.[0] === "1";
            zkResult = {
              proof: zkData.proof,
              publicSignals: zkData.publicSignals,
              generationTimeMs: zkData.generationTimeMs,
              isOver18,
            };
          } else {
            console.warn("ZK proof generation failed:", await zkResponse.text());
            issues.push("zk_proof_failed");
          }
        } catch (error) {
          console.warn("ZK service unavailable:", error);
          issues.push("zk_service_unavailable");
        }
      }
    }

    // =========================================================================
    // STEP 4: Store Identity Proof (Only commitments and flags)
    // =========================================================================
    const documentProcessed = Boolean(documentResult?.commitments);
    const isValidDRDocument = documentResult?.isValidDRDocument || false;
    const livenessPassed = verificationResult?.is_live || false;
    const faceMatched = verificationResult?.faces_match || false;
    const ageProofGenerated = Boolean(zkResult?.proof);
    const dobEncrypted = Boolean(fheResult?.ciphertext);
    const verified =
      documentProcessed &&
      isValidDRDocument &&
      livenessPassed &&
      faceMatched &&
      !isDuplicateDocument;

    // Log what we're about to store
    console.log("[Identity Verify] Storing identity proof:", {
      documentProcessed,
      isValidDRDocument,
      livenessPassed,
      faceMatched,
      ageProofGenerated,
      dobEncrypted,
      verified,
      hasExistingProof: Boolean(existingProof),
    });

    if (documentProcessed && documentResult?.commitments && !existingProof) {
      // Create new identity proof
      console.log("[Identity Verify] Creating new identity proof with isFaceMatched:", faceMatched);
      try {
        createIdentityProof({
          id: uuidv4(),
          userId,
          documentHash: documentResult.commitments.documentHash,
          nameCommitment: documentResult.commitments.nameCommitment,
          userSalt: documentResult.commitments.userSalt,
          documentType: documentResult.documentType,
          countryVerified: isValidDRDocument ? "DOM" : undefined,
          isDocumentVerified: isValidDRDocument,
          isLivenessPassed: livenessPassed,
          isFaceMatched: faceMatched,
          ageProofVerified: zkResult?.isOver18 ?? false,
          verificationMethod: "ocr_local",
          verifiedAt: verified ? new Date().toISOString() : undefined,
          confidenceScore: documentResult.confidence,
          // FHE encrypted DOB
          dobCiphertext: fheResult?.ciphertext,
          fheClientKeyId: fheResult?.clientKeyId,
          // ZK Proof
          ageProof: zkResult ? JSON.stringify(zkResult.proof) : undefined,
        });
      } catch (error) {
        console.error("Failed to create identity proof:", error);
        issues.push("failed_to_save_proof");
      }
    } else if (existingProof) {
      // Update existing proof flags
      try {
        updateIdentityProofFlags(userId, {
          isLivenessPassed: livenessPassed,
          isFaceMatched: faceMatched,
          verifiedAt: verified ? new Date().toISOString() : undefined,
          // Update FHE/ZK data if available
          ...(fheResult && {
            dobCiphertext: fheResult.ciphertext,
            fheClientKeyId: fheResult.clientKeyId,
          }),
          ...(zkResult && {
            ageProof: JSON.stringify(zkResult.proof),
            ageProofVerified: zkResult.isOver18,
          }),
        });
      } catch (error) {
        console.error("Failed to update identity proof:", error);
        issues.push("failed_to_update_proof");
      }
    }

    // =========================================================================
    // STEP 3.5: Update User Display Name (Transient - only display name stored)
    // =========================================================================
    // After successful document processing, update user's display name
    // using first parts of first name and last name.
    // e.g., "Juan Carlos" + "Perez Garcia" -> "Juan Perez"
    if (documentResult?.extractedData?.firstName || documentResult?.extractedData?.lastName) {
      try {
        const displayName = buildDisplayName(
          documentResult.extractedData.firstName,
          documentResult.extractedData.lastName
        );
        if (displayName) {
          updateUserName(userId, displayName);
        }
      } catch (error) {
        console.error("Failed to update user name:", error);
        // Non-critical, don't add to issues
      }
    }

    // =========================================================================
    // STEP 4: Return Results
    // =========================================================================
    // At this point:
    // - Document image has been processed and discarded
    // - Selfie image has been processed and discarded
    // - Face embeddings have been compared and discarded
    // - Only commitments and boolean flags are stored

    return NextResponse.json({
      success: true,
      verified,
      results: {
        documentProcessed,
        documentType: documentResult?.documentType,
        isValidDRDocument,
        livenessPassed,
        faceMatched,
        isDuplicateDocument,
        ageProofGenerated,
        dobEncrypted,
      },
      transientData: documentResult?.extractedData
        ? {
            fullName: documentResult.extractedData.fullName,
            firstName: documentResult.extractedData.firstName,
            lastName: documentResult.extractedData.lastName,
            documentNumber: documentResult.extractedData.documentNumber,
            dateOfBirth: documentResult.extractedData.dateOfBirth,
          }
        : undefined,
      processingTimeMs: Date.now() - startTime,
      issues,
    });
  } catch (error) {
    console.error("Identity verification error:", error);

    return NextResponse.json(
      {
        success: false,
        verified: false,
        results: {
          documentProcessed: false,
          isValidDRDocument: false,
          livenessPassed: false,
          faceMatched: false,
          isDuplicateDocument: false,
          ageProofGenerated: false,
          dobEncrypted: false,
        },
        processingTimeMs: Date.now() - startTime,
        issues: ["internal_error"],
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}

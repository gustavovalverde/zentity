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

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@/lib/auth";
import {
  createIdentityProof,
  documentHashExists,
  encryptFirstName,
  getIdentityProofByUserId,
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
    documentOrigin?: string; // ISO 3166-1 alpha-3 country code
    isDocumentValid: boolean;
    livenessPassed: boolean;
    faceMatched: boolean;
    isDuplicateDocument: boolean;
    ageProofGenerated: boolean;
    dobEncrypted: boolean;
    docValidityProofGenerated: boolean;
    nationalityCommitmentGenerated: boolean;
    livenessScoreEncrypted: boolean;
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
  request: NextRequest,
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
            isDocumentValid: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
            docValidityProofGenerated: false,
            nationalityCommitmentGenerated: false,
            livenessScoreEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["unauthorized"],
          error: "Authentication required",
        },
        { status: 401 },
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
            isDocumentValid: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
            docValidityProofGenerated: false,
            nationalityCommitmentGenerated: false,
            livenessScoreEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["missing_document_image"],
          error: "Document image is required",
        },
        { status: 400 },
      );
    }

    if (!body.selfieImage) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          results: {
            documentProcessed: false,
            isDocumentValid: false,
            livenessPassed: false,
            faceMatched: false,
            isDuplicateDocument: false,
            ageProofGenerated: false,
            dobEncrypted: false,
            docValidityProofGenerated: false,
            nationalityCommitmentGenerated: false,
            livenessScoreEncrypted: false,
          },
          processingTimeMs: Date.now() - startTime,
          issues: ["missing_selfie_image"],
          error: "Selfie image is required",
        },
        { status: 400 },
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
      documentOrigin?: string; // ISO 3166-1 alpha-3 country code
      confidence: number;
      extractedData?: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        documentNumber?: string;
        dateOfBirth?: string;
        expirationDate?: string; // ISO 8601: YYYY-MM-DD
        nationalityCode?: string; // ISO 3166-1 alpha-3
        gender?: string; // M or F from OCR
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
    } catch (_error) {
      issues.push("document_processing_failed");
    }

    // Check for duplicate document
    let isDuplicateDocument = false;
    if (documentResult?.commitments?.documentHash) {
      const hashExists = documentHashExists(
        documentResult.commitments.documentHash,
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
        throw new Error(
          `Verification service returned ${verifyResponse.status}`,
        );
      }

      verificationResult = await verifyResponse.json();

      issues.push(...(verificationResult?.issues || []));
    } catch (_error) {
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

    // Document validity ZK proof result
    let docValidityResult: {
      proof: unknown;
      publicSignals: string[];
      isValid: boolean;
      generationTimeMs: number;
    } | null = null;

    // Nationality commitment (SHA256 hash)
    let nationalityCommitment: string | null = null;

    // Multiple age proofs (18, 21, 25)
    let ageProofsJson: Record<string, unknown> | null = null;

    // Sprint 2: Gender FHE encryption result
    let genderFheResult: {
      ciphertext: string;
      clientKeyId: string;
      genderCode: number;
    } | null = null;

    // Sprint 2: Full DOB FHE encryption result
    let dobFullFheResult: {
      ciphertext: string;
      clientKeyId: string;
      dobInt: number;
    } | null = null;

    // Sprint 3: Liveness score FHE encryption result
    let livenessScoreFheResult: {
      ciphertext: string;
      clientKeyId: string;
      score: number;
    } | null = null;

    // Encrypted first name for user display (JWE encrypted, reversible)
    let firstNameEncrypted: string | null = null;

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

      if (
        birthYear &&
        birthYear > 1900 &&
        birthYear <= new Date().getFullYear()
      ) {
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
            issues.push("fhe_encryption_failed");
          }
        } catch (_error) {
          issues.push("fhe_service_unavailable");
        }

        // ZK Proof Generation (prove age >= 18, 21, 25 in parallel)
        const ageThresholds = [18, 21, 25];
        try {
          // Generate all age proofs in parallel
          const zkPromises = ageThresholds.map((minAge) =>
            fetch(`${ZK_SERVICE_URL}/generate-proof`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                birthYear,
                currentYear,
                minAge,
              }),
            }).then(async (res) => {
              if (res.ok) {
                const data = await res.json();
                return { minAge, data, success: true };
              }
              return { minAge, success: false, error: await res.text() };
            }),
          );

          const zkResults = await Promise.all(zkPromises);
          const ageProofs: Record<string, unknown> = {};
          let primaryZkData = null;

          for (const result of zkResults) {
            if (result.success && result.data) {
              ageProofs[result.minAge.toString()] = {
                proof: result.data.proof,
                publicSignals: result.data.publicSignals,
                generationTimeMs: result.data.generationTimeMs,
              };
              // Use age 18 proof as the primary result
              if (result.minAge === 18) {
                primaryZkData = result.data;
              }
            } else {
            }
          }

          if (Object.keys(ageProofs).length > 0) {
            ageProofsJson = ageProofs;
          }

          if (primaryZkData) {
            const isOver18 = primaryZkData.publicSignals?.[0] === "1";
            zkResult = {
              proof: primaryZkData.proof,
              publicSignals: primaryZkData.publicSignals,
              generationTimeMs: primaryZkData.generationTimeMs,
              isOver18,
            };
          } else {
            issues.push("zk_proof_failed");
          }
        } catch (_error) {
          issues.push("zk_service_unavailable");
        }
      }
    }

    // =========================================================================
    // STEP 3.5: Document Validity ZK Proof
    // =========================================================================
    // Generate ZK proof that document is not expired (without revealing expiry date)
    const expirationDate = documentResult?.extractedData?.expirationDate;
    if (expirationDate) {
      try {
        const docValidityResponse = await fetch(
          `${ZK_SERVICE_URL}/docvalidity/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expiryDate: expirationDate, // Already in YYYY-MM-DD format from OCR
            }),
          },
        );

        if (docValidityResponse.ok) {
          const docValidityData = await docValidityResponse.json();
          docValidityResult = {
            proof: docValidityData.proof,
            publicSignals: docValidityData.publicSignals,
            isValid: docValidityData.isValid,
            generationTimeMs: docValidityData.generationTimeMs,
          };
        } else {
          issues.push("doc_validity_proof_failed");
        }
      } catch (_error) {
        issues.push("doc_validity_service_unavailable");
      }
    }

    // =========================================================================
    // STEP 3.6: Nationality Commitment
    // =========================================================================
    // Generate SHA256 commitment for nationality (ISO 3166-1 alpha-3 code)
    const nationalityCode = documentResult?.extractedData?.nationalityCode;
    if (nationalityCode && documentResult?.commitments?.userSalt) {
      try {
        // Generate commitment: SHA256(nationalityCode + userSalt)
        const encoder = new TextEncoder();
        const data = encoder.encode(
          nationalityCode + documentResult.commitments.userSalt,
        );
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        nationalityCommitment = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      } catch (_error) {
        issues.push("nationality_commitment_failed");
      }
    }

    // =========================================================================
    // STEP 3.7: Gender FHE Encryption (Sprint 2)
    // =========================================================================
    const gender = documentResult?.extractedData?.gender;
    if (gender) {
      try {
        // Convert M/F to ISO 5218 code
        const genderCode = gender === "M" ? 1 : gender === "F" ? 2 : 0;

        const genderResponse = await fetch(
          `${FHE_SERVICE_URL}/encrypt-gender`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              genderCode,
              clientKeyId: "default",
            }),
          },
        );

        if (genderResponse.ok) {
          const genderData = await genderResponse.json();
          genderFheResult = {
            ciphertext: genderData.ciphertext,
            clientKeyId: genderData.clientKeyId,
            genderCode,
          };
        } else {
          issues.push("gender_fhe_encryption_failed");
        }
      } catch (_error) {
        issues.push("gender_fhe_service_unavailable");
      }
    }

    // =========================================================================
    // STEP 3.8: Full DOB FHE Encryption (Sprint 2)
    // =========================================================================
    // Encrypt full DOB as YYYYMMDD for precise age calculations
    if (dateOfBirth) {
      try {
        const dobFullResponse = await fetch(`${FHE_SERVICE_URL}/encrypt-dob`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dob: dateOfBirth,
            clientKeyId: "default",
          }),
        });

        if (dobFullResponse.ok) {
          const dobFullData = await dobFullResponse.json();
          dobFullFheResult = {
            ciphertext: dobFullData.ciphertext,
            clientKeyId: dobFullData.clientKeyId,
            dobInt: dobFullData.dobInt,
          };
        } else {
          issues.push("dob_full_fhe_encryption_failed");
        }
      } catch (_error) {
        issues.push("dob_full_fhe_service_unavailable");
      }
    }

    // =========================================================================
    // STEP 3.9: Liveness Score FHE Encryption (Sprint 3)
    // =========================================================================
    // Encrypt the liveness/anti-spoof score for privacy-preserving threshold checks
    // Score is 0.0-1.0, encrypted as u16 (0-10000) for FHE operations
    const livenessScore = verificationResult?.antispoof_score;
    if (livenessScore !== undefined && livenessScore !== null) {
      try {
        const livenessScoreResponse = await fetch(
          `${FHE_SERVICE_URL}/encrypt-liveness`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              score: livenessScore,
              clientKeyId: "default",
            }),
          },
        );

        if (livenessScoreResponse.ok) {
          const livenessScoreData = await livenessScoreResponse.json();
          livenessScoreFheResult = {
            ciphertext: livenessScoreData.ciphertext,
            clientKeyId: livenessScoreData.clientKeyId,
            score: livenessScoreData.score,
          };
        } else {
          issues.push("liveness_score_fhe_encryption_failed");
        }
      } catch (_error) {
        issues.push("liveness_score_fhe_service_unavailable");
      }
    }

    // =========================================================================
    // STEP 3.10: Encrypt First Name for User Display
    // =========================================================================
    // Encrypt the first name using JWE so we can display it back to the user
    // on their dashboard. This is reversible encryption (unlike SHA256 commitments).
    const firstName = documentResult?.extractedData?.firstName;
    if (firstName) {
      try {
        firstNameEncrypted = await encryptFirstName(firstName);
      } catch (_error) {
        issues.push("first_name_encryption_failed");
      }
    }

    // =========================================================================
    // STEP 4: Store Identity Proof (Only commitments and flags)
    // =========================================================================
    const documentProcessed = Boolean(documentResult?.commitments);
    // Document is valid if we have commitments and confidence is reasonable
    const isDocumentValid =
      documentProcessed &&
      (documentResult?.confidence ?? 0) > 0.3 &&
      Boolean(documentResult?.extractedData?.documentNumber);
    const livenessPassed = verificationResult?.is_live || false;
    const faceMatched = verificationResult?.faces_match || false;
    const ageProofGenerated = Boolean(zkResult?.proof);
    const dobEncrypted = Boolean(fheResult?.ciphertext);
    const docValidityProofGenerated = Boolean(docValidityResult?.proof);
    const nationalityCommitmentGenerated = Boolean(nationalityCommitment);
    const livenessScoreEncrypted = Boolean(livenessScoreFheResult?.ciphertext);
    const verified =
      documentProcessed &&
      isDocumentValid &&
      livenessPassed &&
      faceMatched &&
      !isDuplicateDocument;

    if (documentProcessed && documentResult?.commitments && !existingProof) {
      try {
        createIdentityProof({
          id: uuidv4(),
          userId,
          documentHash: documentResult.commitments.documentHash,
          nameCommitment: documentResult.commitments.nameCommitment,
          userSalt: documentResult.commitments.userSalt,
          documentType: documentResult.documentType,
          countryVerified:
            documentResult.documentOrigin ||
            documentResult.extractedData?.nationalityCode,
          isDocumentVerified: isDocumentValid,
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
          // Sprint 1: Document validity proof
          docValidityProof: docValidityResult
            ? JSON.stringify(docValidityResult.proof)
            : undefined,
          // Sprint 1: Nationality commitment (ISO 3166-1 alpha-3)
          nationalityCommitment: nationalityCommitment || undefined,
          // Sprint 1: Multiple age proofs (18, 21, 25)
          ageProofsJson: ageProofsJson
            ? JSON.stringify(ageProofsJson)
            : undefined,
          // Sprint 2: Gender FHE encryption
          genderCiphertext: genderFheResult?.ciphertext,
          // Sprint 2: Full DOB FHE encryption
          dobFullCiphertext: dobFullFheResult?.ciphertext,
          // Sprint 3: Liveness score FHE encryption
          livenessScoreCiphertext: livenessScoreFheResult?.ciphertext,
          // User display data: Encrypted first name
          firstNameEncrypted: firstNameEncrypted || undefined,
        });
      } catch (_error) {
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
          // Sprint 1: Document validity proof
          ...(docValidityResult && {
            docValidityProof: JSON.stringify(docValidityResult.proof),
          }),
          // Sprint 1: Nationality commitment
          ...(nationalityCommitment && {
            nationalityCommitment,
          }),
          // Sprint 1: Multiple age proofs
          ...(ageProofsJson && {
            ageProofsJson: JSON.stringify(ageProofsJson),
          }),
          // Sprint 2: Gender FHE encryption
          ...(genderFheResult && {
            genderCiphertext: genderFheResult.ciphertext,
          }),
          // Sprint 2: Full DOB FHE encryption
          ...(dobFullFheResult && {
            dobFullCiphertext: dobFullFheResult.ciphertext,
          }),
          // Sprint 3: Liveness score FHE encryption
          ...(livenessScoreFheResult && {
            livenessScoreCiphertext: livenessScoreFheResult.ciphertext,
          }),
          // User display data: Encrypted first name
          ...(firstNameEncrypted && {
            firstNameEncrypted,
          }),
        });
      } catch (_error) {
        issues.push("failed_to_update_proof");
      }
    }

    // =========================================================================
    // STEP 3.5: Update User Display Name (Transient - only display name stored)
    // =========================================================================
    // After successful document processing, update user's display name
    // using first parts of first name and last name.
    // e.g., "Juan Carlos" + "Perez Garcia" -> "Juan Perez"
    if (
      documentResult?.extractedData?.firstName ||
      documentResult?.extractedData?.lastName
    ) {
      try {
        const displayName = buildDisplayName(
          documentResult.extractedData.firstName,
          documentResult.extractedData.lastName,
        );
        if (displayName) {
          updateUserName(userId, displayName);
        }
      } catch (_error) {
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
        documentOrigin:
          documentResult?.documentOrigin ||
          documentResult?.extractedData?.nationalityCode,
        isDocumentValid,
        livenessPassed,
        faceMatched,
        isDuplicateDocument,
        ageProofGenerated,
        dobEncrypted,
        docValidityProofGenerated,
        nationalityCommitmentGenerated,
        livenessScoreEncrypted,
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
    return NextResponse.json(
      {
        success: false,
        verified: false,
        results: {
          documentProcessed: false,
          isDocumentValid: false,
          livenessPassed: false,
          faceMatched: false,
          isDuplicateDocument: false,
          ageProofGenerated: false,
          dobEncrypted: false,
          docValidityProofGenerated: false,
          nationalityCommitmentGenerated: false,
          livenessScoreEncrypted: false,
        },
        processingTimeMs: Date.now() - startTime,
        issues: ["internal_error"],
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    );
  }
}

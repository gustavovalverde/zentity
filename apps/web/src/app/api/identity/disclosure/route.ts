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
 * Crypto exchanges/banks need Name, DOB, Nationality for KYC/AML compliance.
 * This enables that while:
 * 1. Protecting user privacy (E2E encryption)
 * 2. Providing cryptographic proofs (ZK)
 * 3. Minimizing Zentity's liability (no PII storage)
 */

import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { type NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireSession } from "@/lib/api-auth";
import { bytesToBase64 } from "@/lib/base64";
import {
  getIdentityProofByUserId,
  getUserAgeProofPayload,
  getVerificationStatus,
} from "@/lib/db";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { detectFromBase64, getHumanServer } from "@/lib/human-server";
import { processDocumentOcr } from "@/lib/ocr-client";
import { CIRCUIT_SPECS, parsePublicInputToNumber } from "@/lib/zk-circuit-spec";
import faceMatchCircuit from "@/noir-circuits/face_match/artifacts/face_match.json";

interface DisclosureRequest {
  // RP identification
  rpId: string;
  rpName?: string;
  rpPublicKey: string; // Base64 encoded RSA public key (SPKI format)

  // Document for fresh PII extraction
  documentImage: string;

  // Selfie for face match proof generation
  selfieImage: string;

  // Fields to include in disclosure
  fields: {
    fullName?: boolean;
    dateOfBirth?: boolean;
    nationality?: boolean;
    documentType?: boolean;
    documentNumber?: boolean;
  };

  // Optional: threshold for face match proof
  faceMatchThreshold?: number;
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
      proof: unknown;
      publicSignals: string[];
      isMatch: boolean;
      threshold: number;
    };
    ageProof?: {
      proof: unknown;
      publicSignals: string[];
      isOver18: boolean;
    };
    livenessAttestation?: {
      verified: boolean;
      timestamp: string;
      method: string;
    };
  };

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

    if (!body.documentImage || !body.selfieImage) {
      return NextResponse.json(
        {
          success: false,
          packageId,
          encryptionMethod: "none",
          encryptedFields: [],
          proofs: {},
          createdAt,
          expiresAt,
          error: "Document and selfie images are required for disclosure",
        },
        { status: 400 },
      );
    }

    // Get existing identity proof for user salt
    const identityProof = getIdentityProofByUserId(userId);

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
      documentType?: string;
      documentOrigin?: string;
    } | null = null;

    try {
      documentResult = await processDocumentOcr({
        image: body.documentImage,
        userSalt: identityProof?.userSalt,
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

    // =========================================================================
    // STEP 2: Generate Face Match ZK Proof using Human.js + ZK Service
    // =========================================================================
    let faceMatchProof: {
      proof: unknown;
      publicSignals: string[];
      isMatch: boolean;
      threshold: number;
    } | null = null;

    try {
      const human = await getHumanServer();
      const proofThreshold = body.faceMatchThreshold || 0.6;

      // Detect faces in both images using Human.js
      const [selfieResult, docResult] = await Promise.all([
        detectFromBase64(body.selfieImage),
        detectFromBase64(body.documentImage),
      ]);

      // Helper to get largest face
      const selectLargestFace = (
        res: ReturnType<typeof detectFromBase64> extends Promise<infer T>
          ? T
          : never,
      ) => {
        const faces = Array.isArray(res?.face) ? res.face : [];
        if (faces.length === 0) return null;
        return faces.reduce((best: (typeof faces)[0], f: (typeof faces)[0]) => {
          const getArea = (face: (typeof faces)[0]) => {
            const box = face?.box;
            if (!box) return 0;
            if (Array.isArray(box)) return (box[2] ?? 0) * (box[3] ?? 0);
            return (
              ((box as { width?: number }).width ?? 0) *
              ((box as { height?: number }).height ?? 0)
            );
          };
          return getArea(f) > getArea(best) ? f : best;
        }, faces[0]);
      };

      // Helper to get embedding
      const getEmbedding = (
        face: ReturnType<typeof selectLargestFace>,
      ): number[] | null => {
        if (!face) return null;
        const emb =
          (face as { embedding?: number[] | Float32Array }).embedding ??
          (face as { descriptor?: number[] | Float32Array }).descriptor;
        if (!emb) return null;
        if (Array.isArray(emb)) return emb.map((n) => Number(n));
        if (emb instanceof Float32Array) return Array.from(emb);
        return null;
      };

      const selfieFace = selectLargestFace(await selfieResult);
      const docFace = selectLargestFace(await docResult);

      if (selfieFace && docFace) {
        const selfieEmb = getEmbedding(selfieFace);
        const docEmb = getEmbedding(docFace);

        if (selfieEmb && docEmb) {
          // Calculate similarity using Human.js
          const similarityScore = human.match.similarity(docEmb, selfieEmb);

          // Scale to circuit format (0-10000 for 0.00%-100.00%)
          const scaledScore = Math.round(similarityScore * 10000);
          const scaledThreshold = Math.round(proofThreshold * 10000);

          // Generate ZK proof using face_match circuit
          const noir = new Noir(faceMatchCircuit as never);
          const backend = new UltraHonkBackend(
            (faceMatchCircuit as { bytecode: string }).bytecode,
          );

          // Generate a disclosure-specific nonce (not validated, just for uniqueness)
          const disclosureNonce = `0x${crypto.randomUUID().replace(/-/g, "")}`;

          const { witness } = await noir.execute({
            similarity_score: scaledScore.toString(),
            threshold: scaledThreshold.toString(),
            nonce: disclosureNonce,
          });

          const proofResult = await backend.generateProof(witness);
          const isMatch =
            parsePublicInputToNumber(
              proofResult.publicInputs[CIRCUIT_SPECS.face_match.resultIndex],
            ) === 1;

          faceMatchProof = {
            proof: bytesToBase64(proofResult.proof),
            publicSignals: proofResult.publicInputs,
            isMatch,
            threshold: proofThreshold,
          };
        }
      }
    } catch (_error) {
      // Non-fatal: continue without face match proof
    }

    // =========================================================================
    // STEP 3: Get existing age proof (if available)
    // =========================================================================
    const ageProof = getUserAgeProofPayload(userId);

    // =========================================================================
    // STEP 4: Build and encrypt PII package
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
    // STEP 5: Build response with proofs
    // =========================================================================
    const proofs: DisclosureResponse["proofs"] = {};

    if (faceMatchProof) {
      proofs.faceMatch = faceMatchProof;
    }

    if (ageProof) {
      proofs.ageProof = ageProof;
    }

    // Liveness attestation (signed statement)
    if (identityProof?.isLivenessPassed) {
      proofs.livenessAttestation = {
        verified: true,
        timestamp: identityProof.verifiedAt || createdAt,
        method: identityProof.verificationMethod || "standard",
      };
    }

    // PII has been extracted, encrypted, and is being returned
    // Document image is NOT stored - only transmitted to OCR service transiently
    // Encrypted package can only be decrypted by RP

    return NextResponse.json({
      success: true,
      packageId,
      encryptedPackage,
      encryptionMethod: "RSA-OAEP+AES-GCM-256",
      encryptedFields,
      proofs,
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

/**
 * Mock Disclosure Package
 *
 * Simulates Zentity creating a disclosure package for the exchange.
 * Uses mock PII data encrypted to the exchange's public key.
 */

import { type NextRequest, NextResponse } from "next/server";

interface ProofInput {
  proof: string;
  publicSignals: string[];
}

interface ProofsInput {
  ageProof?: ProofInput;
  faceMatchProof?: ProofInput;
  docValidityProof?: ProofInput;
}

// Mock PII data (in real flow, this comes from user's verified data)
const MOCK_PII = {
  fullName: "Juan Carlos Perez Martinez",
  dateOfBirth: "1990-05-15",
  nationality: "DOMINICANA",
  documentNumber: "001-1234567-8",
};

// Mock ZK proofs (shape only; these are not valid cryptographic proofs)
const MOCK_AGE_PROOF = {
  proof: "bW9jay1hZ2UtcHJvb2Y=",
  // Public inputs: [current_year, min_age, nonce, claim_hash, is_old_enough]
  publicSignals: [String(new Date().getFullYear()), "18", "0x01", "0x02", "1"],
};

const MOCK_FACE_MATCH_PROOF = {
  proof: "bW9jay1mYWNlLW1hdGNoLXByb29m",
  // Public inputs: [threshold, nonce, claim_hash, is_match]
  publicSignals: ["6000", "0x01", "0x02", "1"],
};

const MOCK_DOC_VALIDITY_PROOF = {
  proof: "bW9jay1kb2MtdmFsaWRpdHktcHJvb2Y=",
  // Public inputs: [current_date, nonce, claim_hash, is_valid]
  publicSignals: (() => {
    const now = new Date();
    const currentDate = Number(
      `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    );
    return [String(currentDate), "0x01", "0x02", "1"];
  })(),
};

export async function POST(request: NextRequest) {
  try {
    const { rpPublicKey, proofs } = (await request.json()) as {
      rpPublicKey: string;
      proofs?: ProofsInput;
    };

    if (!rpPublicKey) {
      return NextResponse.json(
        { error: "rpPublicKey is required" },
        { status: 400 },
      );
    }

    const providedProofs: ProofsInput = {
      ageProof:
        proofs?.ageProof &&
        typeof proofs.ageProof.proof === "string" &&
        Array.isArray(proofs.ageProof.publicSignals)
          ? {
              proof: proofs.ageProof.proof,
              publicSignals: proofs.ageProof.publicSignals.map(String),
            }
          : undefined,
      faceMatchProof:
        proofs?.faceMatchProof &&
        typeof proofs.faceMatchProof.proof === "string" &&
        Array.isArray(proofs.faceMatchProof.publicSignals)
          ? {
              proof: proofs.faceMatchProof.proof,
              publicSignals: proofs.faceMatchProof.publicSignals.map(String),
            }
          : undefined,
      docValidityProof:
        proofs?.docValidityProof &&
        typeof proofs.docValidityProof.proof === "string" &&
        Array.isArray(proofs.docValidityProof.publicSignals)
          ? {
              proof: proofs.docValidityProof.proof,
              publicSignals: proofs.docValidityProof.publicSignals.map(String),
            }
          : undefined,
    };

    // Parse the public key
    const publicKeyJwk = JSON.parse(rpPublicKey);

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );

    // Generate AES key for hybrid encryption
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    // Encrypt PII with AES
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const piiBytes = new TextEncoder().encode(JSON.stringify(MOCK_PII));
    const encryptedPii = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      piiBytes,
    );

    // Encrypt AES key with RSA
    const aesKeyRaw = await crypto.subtle.exportKey("raw", aesKey);
    const encryptedAesKey = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      aesKeyRaw,
    );

    // Create liveness attestation
    const livenessAttestation = {
      verified: true,
      timestamp: new Date().toISOString(),
      signature: `mock-signature-${crypto.randomUUID().slice(0, 8)}`,
    };

    // Build disclosure package
    const disclosurePackage = {
      encryptedPii: {
        iv: Buffer.from(iv).toString("base64"),
        encryptedData: Buffer.from(encryptedPii).toString("base64"),
        encryptedAesKey: Buffer.from(encryptedAesKey).toString("base64"),
      },
      proofs: {
        ageProof: providedProofs.ageProof ?? MOCK_AGE_PROOF,
        faceMatchProof: providedProofs.faceMatchProof ?? MOCK_FACE_MATCH_PROOF,
        docValidityProof:
          providedProofs.docValidityProof ?? MOCK_DOC_VALIDITY_PROOF,
      },
      evidence: {
        policyVersion: "compliance-policy-2025-12-28",
        policyHash: "mock-policy-hash",
        proofSetHash: "mock-proof-set-hash",
      },
      livenessAttestation,
      metadata: {
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        rpId: "crypto-exchange-demo",
      },
    };

    return NextResponse.json(disclosurePackage);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create disclosure package" },
      { status: 500 },
    );
  }
}

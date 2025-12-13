/**
 * Verify ZK Proofs Route (Demo)
 *
 * Simulates the exchange verifying Noir/UltraHonk ZK proofs.
 * Uses the same verifier as the main /api/crypto/verify-proof endpoint.
 */

import { type NextRequest, NextResponse } from "next/server";
import { verifyNoirProof } from "@/lib/noir-verifier";
import { CIRCUIT_SPECS, parsePublicInputToNumber } from "@/lib/zk-circuit-spec";

interface Proof {
  proof: string; // Base64 encoded UltraHonk ZK proof
  publicSignals: string[];
}

interface ProofsInput {
  ageProof?: Proof;
  faceMatchProof?: Proof;
  docValidityProof?: Proof;
}

export async function POST(request: NextRequest) {
  try {
    const { proofs } = (await request.json()) as { proofs: ProofsInput };

    if (!proofs) {
      return NextResponse.json(
        { error: "proofs object is required" },
        { status: 400 },
      );
    }

    const results: {
      ageProofValid?: boolean;
      faceMatchValid?: boolean;
      docValidityValid?: boolean;
    } = {};

    // Verify age proof using Noir/UltraHonk
    if (proofs.ageProof) {
      try {
        const data = await verifyNoirProof({
          proof: proofs.ageProof.proof,
          publicInputs: proofs.ageProof.publicSignals,
          circuitType: "age_verification",
        });
        // Check both cryptographic validity AND circuit output
        // Public inputs: [current_year, min_age, nonce, is_old_enough]
        const isOldEnough = parsePublicInputToNumber(
          proofs.ageProof.publicSignals[
            CIRCUIT_SPECS.age_verification.resultIndex
          ],
        );
        results.ageProofValid = data.isValid && isOldEnough === 1;
      } catch {
        // Verification failed
        results.ageProofValid = false;
      }
    }

    // Verify face match proof using Noir/UltraHonk
    if (proofs.faceMatchProof) {
      try {
        const data = await verifyNoirProof({
          proof: proofs.faceMatchProof.proof,
          publicInputs: proofs.faceMatchProof.publicSignals,
          circuitType: "face_match",
        });
        // Public inputs: [threshold, nonce, is_match]
        const isMatch = parsePublicInputToNumber(
          proofs.faceMatchProof.publicSignals[
            CIRCUIT_SPECS.face_match.resultIndex
          ],
        );
        results.faceMatchValid = data.isValid && isMatch === 1;
      } catch {
        results.faceMatchValid = false;
      }
    }

    // Verify document validity proof using Noir/UltraHonk
    if (proofs.docValidityProof) {
      try {
        const data = await verifyNoirProof({
          proof: proofs.docValidityProof.proof,
          publicInputs: proofs.docValidityProof.publicSignals,
          circuitType: "doc_validity",
        });
        // Check both cryptographic validity AND circuit output
        // Public inputs: [current_date, nonce, is_valid]
        const isDocValid = parsePublicInputToNumber(
          proofs.docValidityProof.publicSignals[
            CIRCUIT_SPECS.doc_validity.resultIndex
          ],
        );
        results.docValidityValid = data.isValid && isDocValid === 1;
      } catch {
        // Verification failed
        results.docValidityValid = false;
      }
    }

    return NextResponse.json(results);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to verify proofs" },
      { status: 500 },
    );
  }
}

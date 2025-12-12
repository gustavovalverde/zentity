/**
 * Verify ZK Proofs Route
 *
 * Simulates the exchange verifying the ZK proofs.
 * In production, this would call the actual ZK service verification endpoints.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  verifyDocValidityProofZk,
  verifyFaceMatchProofZk,
  verifyProofZk,
} from "@/lib/zk-client";

interface Proof {
  proof: object;
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

    // Try to verify each proof against the real ZK service
    // If ZK service is not available, use mock verification

    // Verify age proof
    if (proofs.ageProof) {
      try {
        const data = await verifyProofZk({
          proof: proofs.ageProof.proof,
          publicSignals: proofs.ageProof.publicSignals,
        });
        results.ageProofValid = data.isValid;
      } catch {
        // ZK service not available, mock verification
        results.ageProofValid = proofs.ageProof.publicSignals[0] === "1";
      }
    }

    // Verify face match proof
    if (proofs.faceMatchProof) {
      try {
        const data = await verifyFaceMatchProofZk({
          proof: proofs.faceMatchProof.proof,
          publicSignals: proofs.faceMatchProof.publicSignals,
        });
        results.faceMatchValid = data.isValid;
      } catch {
        // Mock verification
        results.faceMatchValid = proofs.faceMatchProof.publicSignals[0] === "1";
      }
    }

    // Verify document validity proof
    if (proofs.docValidityProof) {
      try {
        const data = await verifyDocValidityProofZk({
          proof: proofs.docValidityProof.proof,
          publicSignals: proofs.docValidityProof.publicSignals,
        });
        results.docValidityValid = data.isValid;
      } catch {
        // Mock verification
        results.docValidityValid =
          proofs.docValidityProof.publicSignals[0] === "1";
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

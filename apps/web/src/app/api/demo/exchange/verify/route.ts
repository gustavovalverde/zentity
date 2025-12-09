/**
 * Verify ZK Proofs Route
 *
 * Simulates the exchange verifying the ZK proofs.
 * In production, this would call the actual ZK service verification endpoints.
 */

import { type NextRequest, NextResponse } from "next/server";

const ZK_SERVICE_URL = process.env.ZK_SERVICE_URL || "http://localhost:5002";

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
        const res = await fetch(`${ZK_SERVICE_URL}/verify-proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proofs.ageProof),
        });
        if (res.ok) {
          const data = await res.json();
          results.ageProofValid = data.isValid;
        } else {
          // Mock verification for demo
          results.ageProofValid = proofs.ageProof.publicSignals[0] === "1";
        }
      } catch {
        // ZK service not available, mock verification
        results.ageProofValid = proofs.ageProof.publicSignals[0] === "1";
      }
    }

    // Verify face match proof
    if (proofs.faceMatchProof) {
      try {
        const res = await fetch(`${ZK_SERVICE_URL}/facematch/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proofs.faceMatchProof),
        });
        if (res.ok) {
          const data = await res.json();
          results.faceMatchValid = data.isValid;
        } else {
          // Mock verification
          results.faceMatchValid =
            proofs.faceMatchProof.publicSignals[0] === "1";
        }
      } catch {
        // Mock verification
        results.faceMatchValid = proofs.faceMatchProof.publicSignals[0] === "1";
      }
    }

    // Verify document validity proof
    if (proofs.docValidityProof) {
      try {
        const res = await fetch(`${ZK_SERVICE_URL}/docvalidity/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proofs.docValidityProof),
        });
        if (res.ok) {
          const data = await res.json();
          results.docValidityValid = data.isValid;
        } else {
          // Mock verification
          results.docValidityValid =
            proofs.docValidityProof.publicSignals[0] === "1";
        }
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

/**
 * On-demand Age Proof Generation API
 *
 * Generates a ZK proof that a verified user is above a specific age threshold.
 * This endpoint is used after initial verification when a different age threshold
 * is needed (e.g., 21 for alcohol, 25 for car rental).
 *
 * The proof can be verified by third parties without revealing the actual DOB.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getIdentityProofByUserId } from "@/lib/db";

interface GenerateAgeProofRequest {
  minAge: number;
}

interface GenerateAgeProofResponse {
  success: boolean;
  proof?: unknown;
  publicSignals?: string[];
  isOverAge: boolean;
  minAge: number;
  generationTimeMs?: number;
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<GenerateAgeProofResponse>> {
  try {
    // Authenticate user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          success: false,
          isOverAge: false,
          minAge: 0,
          error: "Authentication required",
        },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const body = (await request.json()) as GenerateAgeProofRequest;

    // Validate minAge
    const { minAge } = body;
    if (!minAge || minAge < 1 || minAge > 150) {
      return NextResponse.json(
        {
          success: false,
          isOverAge: false,
          minAge: minAge || 0,
          error: "minAge must be between 1 and 150",
        },
        { status: 400 }
      );
    }

    // Get user's identity proof to retrieve DOB ciphertext
    const identityProof = getIdentityProofByUserId(userId);
    if (!identityProof) {
      return NextResponse.json(
        {
          success: false,
          isOverAge: false,
          minAge,
          error: "User has not completed identity verification",
        },
        { status: 400 }
      );
    }

    // Check if we already have this age proof cached
    if (identityProof.ageProofsJson) {
      try {
        const existingProofs = JSON.parse(identityProof.ageProofsJson);
        if (existingProofs[minAge.toString()]) {
          const cachedProof = existingProofs[minAge.toString()];
          const isOverAge = cachedProof.publicSignals?.[0] === "1";
          return NextResponse.json({
            success: true,
            proof: cachedProof.proof,
            publicSignals: cachedProof.publicSignals,
            isOverAge,
            minAge,
            generationTimeMs: 0, // Cached
          });
        }
      } catch {
        // Invalid JSON, continue to generate new proof
      }
    }

    // We need the birth year to generate a new proof
    // Since we only store FHE-encrypted DOB, we need to check if the user
    // has completed verification recently and has the data in memory
    // For now, we return an error if the proof isn't cached

    // In a full implementation, we would:
    // 1. Request the user to re-submit their DOB for a one-time proof generation
    // 2. Or use FHE to compute the age check directly on the encrypted data
    // 3. Or store a secure reference to regenerate proofs

    return NextResponse.json(
      {
        success: false,
        isOverAge: false,
        minAge,
        error: `Age proof for ${minAge} not cached. Please complete identity verification again to generate this proof, or contact support for alternative verification methods.`,
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("Generate age proof error:", error);
    return NextResponse.json(
      {
        success: false,
        isOverAge: false,
        minAge: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Retrieve cached age proofs for the authenticated user
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Authenticate user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const identityProof = getIdentityProofByUserId(userId);

    if (!identityProof) {
      return NextResponse.json(
        { error: "User has not completed identity verification" },
        { status: 400 }
      );
    }

    // Parse and return available age proofs
    const availableProofs: Record<string, boolean> = {};
    if (identityProof.ageProofsJson) {
      try {
        const proofs = JSON.parse(identityProof.ageProofsJson);
        for (const age of Object.keys(proofs)) {
          const isOverAge = proofs[age].publicSignals?.[0] === "1";
          availableProofs[age] = isOverAge;
        }
      } catch {
        // Invalid JSON
      }
    }

    // Also include the legacy single age proof if present
    if (identityProof.ageProof && !availableProofs["18"]) {
      availableProofs["18"] = identityProof.ageProofVerified;
    }

    return NextResponse.json({
      success: true,
      userId,
      availableProofs,
      hasVerifiedIdentity: identityProof.isDocumentVerified,
    });
  } catch (error) {
    console.error("Get age proofs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { consumeChallenge } from "@/lib/challenge-store";
import { getTodayAsInt, verifyNoirProof } from "@/lib/noir-verifier";
import {
  CIRCUIT_SPECS,
  type CircuitType,
  isCircuitType,
  normalizeChallengeNonce,
  parsePublicInputToNumber,
} from "@/lib/zk-circuit-spec";

// Server-enforced policy minimums
const MIN_AGE_POLICY = 18;
const MIN_FACE_MATCH_THRESHOLD = 6000; // 60.00% minimum similarity

interface VerifyProofRequest {
  proof: string; // Base64 encoded
  publicInputs: string[];
  circuitType: CircuitType;
  validateNonce?: boolean; // If true, validates and consumes the nonce
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyProofRequest = await request.json();
    const { proof, publicInputs, circuitType, validateNonce } = body;

    // Validate required fields
    if (!proof || !publicInputs || !circuitType) {
      return NextResponse.json(
        { error: "proof, publicInputs, and circuitType are required" },
        { status: 400 },
      );
    }

    if (!isCircuitType(circuitType)) {
      return NextResponse.json(
        {
          error:
            "circuitType must be 'age_verification', 'doc_validity', 'nationality_membership', or 'face_match'",
        },
        { status: 400 },
      );
    }

    const circuitSpec = CIRCUIT_SPECS[circuitType];

    // Validate nonce if requested (replay resistance)
    if (validateNonce) {
      const authResult = await requireSession();
      if (!authResult.ok) {
        return NextResponse.json(
          { error: "Authentication required for nonce validation" },
          { status: 401 },
        );
      }

      if (publicInputs.length <= circuitSpec.nonceIndex) {
        return NextResponse.json(
          {
            error: `Missing nonce at public input index ${circuitSpec.nonceIndex}`,
          },
          { status: 400 },
        );
      }

      const nonceHex = normalizeChallengeNonce(
        publicInputs[circuitSpec.nonceIndex],
      );

      const challenge = consumeChallenge(
        nonceHex,
        circuitType,
        authResult.session.user.id,
      );

      if (!challenge) {
        return NextResponse.json(
          { error: "Invalid or expired challenge nonce" },
          { status: 400 },
        );
      }
    }

    // Policy enforcement for age verification
    // Public inputs order: [current_year, min_age, nonce, is_old_enough]
    if (circuitType === "age_verification") {
      if (publicInputs.length < circuitSpec.minPublicInputs) {
        return NextResponse.json(
          {
            error: `age_verification requires ${circuitSpec.minPublicInputs} public inputs`,
          },
          { status: 400 },
        );
      }

      const providedYear = parsePublicInputToNumber(publicInputs[0]);
      const providedMinAge = parsePublicInputToNumber(publicInputs[1]);
      const actualYear = new Date().getFullYear();

      // Reject if current_year is more than 1 year off
      if (Math.abs(providedYear - actualYear) > 1) {
        return NextResponse.json(
          {
            error: `Invalid current_year: ${providedYear} (expected ~${actualYear})`,
          },
          { status: 400 },
        );
      }

      // Reject if min_age is below server policy
      if (providedMinAge < MIN_AGE_POLICY) {
        return NextResponse.json(
          {
            error: `min_age ${providedMinAge} below policy minimum ${MIN_AGE_POLICY}`,
          },
          { status: 400 },
        );
      }
    }

    // Policy enforcement for doc validity
    // Public inputs order: [current_date, nonce, is_valid]
    if (circuitType === "doc_validity") {
      if (publicInputs.length < circuitSpec.minPublicInputs) {
        return NextResponse.json(
          {
            error: `doc_validity requires ${circuitSpec.minPublicInputs} public inputs`,
          },
          { status: 400 },
        );
      }

      const providedDate = parsePublicInputToNumber(publicInputs[0]);
      const actualDate = getTodayAsInt();

      // Require exact date match (YYYYMMDD integer math is broken across month boundaries)
      if (providedDate !== actualDate) {
        return NextResponse.json(
          {
            error: `Invalid current_date: ${providedDate} (expected ${actualDate})`,
          },
          { status: 400 },
        );
      }
    }

    // Verify the proof cryptographically using Noir/UltraHonk
    const result = await verifyNoirProof({
      proof,
      publicInputs,
      circuitType,
    });

    // If cryptographic verification failed, return immediately
    if (!result.isValid) {
      return NextResponse.json(result);
    }

    // CRITICAL: Enforce circuit output (is_old_enough / is_valid)
    // UltraHonk verifyProof() returns true if the proof is cryptographically valid,
    // but that doesn't mean the circuit's return value is true!
    if (circuitType === "age_verification") {
      // Public inputs: [current_year, min_age, nonce, is_old_enough]
      const isOldEnough = parsePublicInputToNumber(
        publicInputs[circuitSpec.resultIndex],
      );
      if (isOldEnough !== 1) {
        return NextResponse.json({
          isValid: false,
          reason: "Age requirement not met",
          verificationTimeMs: result.verificationTimeMs,
        });
      }
    }

    if (circuitType === "doc_validity") {
      // Public inputs: [current_date, nonce, is_valid]
      const isDocValid = parsePublicInputToNumber(
        publicInputs[circuitSpec.resultIndex],
      );
      if (isDocValid !== 1) {
        return NextResponse.json({
          isValid: false,
          reason: "Document expired",
          verificationTimeMs: result.verificationTimeMs,
        });
      }
    }

    // Nationality membership: public inputs are [merkle_root, nonce, is_member]
    if (circuitType === "nationality_membership") {
      if (publicInputs.length < circuitSpec.minPublicInputs) {
        return NextResponse.json(
          {
            error: `nationality_membership requires ${circuitSpec.minPublicInputs} public inputs`,
          },
          { status: 400 },
        );
      }
      const isMember = parsePublicInputToNumber(
        publicInputs[circuitSpec.resultIndex],
      );
      if (isMember !== 1) {
        return NextResponse.json({
          isValid: false,
          reason: "Nationality not in group",
          verificationTimeMs: result.verificationTimeMs,
        });
      }
    }

    // Face match: public inputs are [threshold, nonce, is_match]
    if (circuitType === "face_match") {
      if (publicInputs.length < circuitSpec.minPublicInputs) {
        return NextResponse.json(
          {
            error: `face_match requires ${circuitSpec.minPublicInputs} public inputs`,
          },
          { status: 400 },
        );
      }

      const providedThreshold = parsePublicInputToNumber(publicInputs[0]);

      // Reject if threshold is below server policy minimum
      if (providedThreshold < MIN_FACE_MATCH_THRESHOLD) {
        return NextResponse.json(
          {
            error: `threshold ${providedThreshold} below policy minimum ${MIN_FACE_MATCH_THRESHOLD} (60.00%)`,
          },
          { status: 400 },
        );
      }

      // Validate threshold is within valid range
      if (providedThreshold > 10000) {
        return NextResponse.json(
          {
            error: `threshold ${providedThreshold} exceeds maximum 10000 (100.00%)`,
          },
          { status: 400 },
        );
      }

      // Public inputs: [threshold, nonce, is_match]
      const isMatch = parsePublicInputToNumber(
        publicInputs[circuitSpec.resultIndex],
      );
      if (isMatch !== 1) {
        return NextResponse.json({
          isValid: false,
          reason: "Face match threshold not met",
          verificationTimeMs: result.verificationTimeMs,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Proof verification failed",
        isValid: false,
      },
      { status: 500 },
    );
  }
}

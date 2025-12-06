/**
 * Name Verification API
 *
 * Allows relying parties to verify if a user's name matches
 * without us ever revealing or storing the actual name.
 *
 * Flow:
 * 1. Relying party asks: "Is this user named Juan Perez?"
 * 2. We compute: hash = SHA256(normalize("Juan Perez") + user_salt)
 * 3. We compare: hash == stored name_commitment
 * 4. We return: { matches: true/false }
 *
 * NO PII IS REVEALED IN THIS PROCESS.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getIdentityProofByUserId } from "@/lib/db";
import crypto from "crypto";

interface VerifyNameRequest {
  // The name to verify (claimed by relying party)
  claimedName: string;
}

interface VerifyNameResponse {
  matches: boolean;
}

/**
 * Normalize name for consistent hashing.
 * Must match the normalization in the OCR service.
 */
function normalizeName(name: string): string {
  // Remove accents using NFD normalization
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

  return normalized;
}

/**
 * Generate name commitment hash.
 * Must match the algorithm in the OCR service.
 */
function generateNameCommitment(fullName: string, userSalt: string): string {
  const normalized = normalizeName(fullName);
  const data = `${normalized}:${userSalt}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<VerifyNameResponse | { error: string }>> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as VerifyNameRequest;

    if (!body.claimedName || body.claimedName.trim().length === 0) {
      return NextResponse.json(
        { error: "Claimed name is required" },
        { status: 400 }
      );
    }

    // Get user's identity proof
    const proof = getIdentityProofByUserId(session.user.id);

    if (!proof) {
      return NextResponse.json(
        { error: "User has not completed identity verification" },
        { status: 404 }
      );
    }

    // Generate commitment for claimed name
    const claimedCommitment = generateNameCommitment(
      body.claimedName,
      proof.userSalt
    );

    // Compare with stored commitment using timing-safe comparison
    const matches = crypto.timingSafeEqual(
      Buffer.from(claimedCommitment),
      Buffer.from(proof.nameCommitment)
    );

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Name verification error:", error);
    return NextResponse.json(
      { error: "Failed to verify name" },
      { status: 500 }
    );
  }
}

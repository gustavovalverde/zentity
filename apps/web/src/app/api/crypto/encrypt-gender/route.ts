/**
 * Gender FHE Encryption API
 *
 * Encrypts gender using ISO/IEC 5218 encoding:
 * - 0 = Not known
 * - 1 = Male
 * - 2 = Female
 * - 9 = Not applicable
 */

import { type NextRequest, NextResponse } from "next/server";
import { encryptGenderFhe } from "@/lib/fhe-client";
import { toServiceErrorPayload } from "@/lib/http-error-payload";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { genderCode, clientKeyId = "default" } = body;

    // Validate ISO 5218 codes
    const validCodes = [0, 1, 2, 9];
    if (!validCodes.includes(genderCode)) {
      return NextResponse.json(
        {
          error: `Invalid gender code. Must be one of: 0 (Not known), 1 (Male), 2 (Female), 9 (Not applicable)`,
        },
        { status: 400 },
      );
    }

    const data = await encryptGenderFhe({
      genderCode,
      clientKeyId,
    });

    return NextResponse.json(data);
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "FHE service error",
    );
    return NextResponse.json(payload, { status });
  }
}

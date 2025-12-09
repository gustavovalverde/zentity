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

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

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

    const response = await fetch(`${FHE_SERVICE_URL}/encrypt-gender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genderCode, clientKeyId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || "FHE service error" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to connect to FHE service" },
      { status: 503 },
    );
  }
}

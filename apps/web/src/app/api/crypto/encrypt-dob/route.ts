/**
 * Full DOB FHE Encryption API
 *
 * Encrypts date of birth as YYYYMMDD integer (u32).
 * Accepts ISO 8601 date strings (YYYY-MM-DD) or YYYYMMDD integers.
 *
 * This enables precise age calculations (age in days, not just years).
 */

import { type NextRequest, NextResponse } from "next/server";
import { encryptDobFhe } from "@/lib/fhe-client";
import { toServiceErrorPayload } from "@/lib/http-error-payload";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dob, birthYear, clientKeyId = "default" } = body;

    // Accept either full DOB (YYYY-MM-DD or YYYYMMDD) or just birth year
    // When only birthYear is provided, construct a DOB using Jan 1
    const dobValue = dob || (birthYear ? `${birthYear}-01-01` : null);

    if (!dobValue) {
      return NextResponse.json(
        { error: "dob or birthYear is required" },
        { status: 400 },
      );
    }

    const data = await encryptDobFhe({
      dob: String(dobValue),
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

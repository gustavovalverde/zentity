/**
 * Full DOB FHE Encryption API
 *
 * Encrypts date of birth as YYYYMMDD integer (u32).
 * Accepts ISO 8601 date strings (YYYY-MM-DD) or YYYYMMDD integers.
 *
 * This enables precise age calculations (age in days, not just years).
 */

import { type NextRequest, NextResponse } from "next/server";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

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

    const response = await fetch(`${FHE_SERVICE_URL}/encrypt-dob`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dob: String(dobValue), clientKeyId }),
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

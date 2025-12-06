import { NextRequest, NextResponse } from "next/server";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { birthYear } = body;

    if (!birthYear || typeof birthYear !== "number") {
      return NextResponse.json(
        { error: "birthYear is required and must be a number" },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const response = await fetch(`${FHE_SERVICE_URL}/encrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthYear }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || "FHE service encryption error" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const encryptionTimeMs = Date.now() - startTime;

    return NextResponse.json({
      ciphertext: data.ciphertext,
      clientKeyId: data.clientKeyId || "default",
      encryptionTimeMs,
    });
  } catch (error) {
    console.error("FHE encrypt DOB error:", error);
    return NextResponse.json(
      { error: "Failed to connect to FHE service" },
      { status: 503 }
    );
  }
}

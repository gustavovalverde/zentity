import { NextRequest, NextResponse } from "next/server";

const FHE_SERVICE_URL = process.env.FHE_SERVICE_URL || "http://localhost:5001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ciphertext, currentYear, minAge = 18 } = body;

    if (!ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const response = await fetch(`${FHE_SERVICE_URL}/verify-age`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciphertext,
        currentYear: currentYear || new Date().getFullYear(),
        minAge,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || "FHE service verification error" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const computationTimeMs = Date.now() - startTime;

    return NextResponse.json({
      isOver18: data.isOver18,
      computationTimeMs,
    });
  } catch (error) {
    console.error("FHE verify age error:", error);
    return NextResponse.json(
      { error: "Failed to connect to FHE service" },
      { status: 503 }
    );
  }
}

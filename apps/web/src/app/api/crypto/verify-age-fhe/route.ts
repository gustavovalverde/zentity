import { type NextRequest, NextResponse } from "next/server";
import { verifyAgeFhe } from "@/lib/fhe-client";
import { toServiceErrorPayload } from "@/lib/http-error-payload";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ciphertext, currentYear, minAge = 18 } = body;

    if (!ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 },
      );
    }

    const startTime = Date.now();
    const data = await verifyAgeFhe({
      ciphertext,
      currentYear: currentYear || new Date().getFullYear(),
      minAge,
    });
    const computationTimeMs = Date.now() - startTime;

    return NextResponse.json({
      isOver18: data.isOver18,
      computationTimeMs,
    });
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to connect to FHE service",
    );
    return NextResponse.json(payload, { status });
  }
}

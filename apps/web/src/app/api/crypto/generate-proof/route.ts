import { type NextRequest, NextResponse } from "next/server";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { generateAgeProofZk } from "@/lib/zk-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { birthYear, currentYear, minAge = 18 } = body;

    if (!birthYear || !currentYear) {
      return NextResponse.json(
        { error: "birthYear and currentYear are required" },
        { status: 400 },
      );
    }

    const data = await generateAgeProofZk({ birthYear, currentYear, minAge });
    return NextResponse.json(data);
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to connect to ZK service",
    );
    return NextResponse.json(payload, { status });
  }
}

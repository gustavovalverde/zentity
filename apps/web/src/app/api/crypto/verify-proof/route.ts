import { type NextRequest, NextResponse } from "next/server";
import { toServiceErrorPayload } from "@/lib/http-error-payload";
import { verifyProofZk } from "@/lib/zk-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proof, publicSignals } = body;

    if (!proof || !publicSignals) {
      return NextResponse.json(
        { error: "proof and publicSignals are required" },
        { status: 400 },
      );
    }

    const data = await verifyProofZk({ proof, publicSignals });
    return NextResponse.json(data);
  } catch (error) {
    const { status, payload } = toServiceErrorPayload(
      error,
      "Failed to connect to ZK service",
    );
    return NextResponse.json(payload, { status });
  }
}

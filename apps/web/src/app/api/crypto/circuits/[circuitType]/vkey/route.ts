import { type NextRequest, NextResponse } from "next/server";
import { getCircuitVerificationKey } from "@/lib/noir-verifier";
import { isCircuitType } from "@/lib/zk-circuit-spec";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ circuitType: string }> },
) {
  const { circuitType } = await context.params;
  if (!isCircuitType(circuitType)) {
    return NextResponse.json(
      {
        error:
          "circuitType must be 'age_verification', 'doc_validity', 'nationality_membership', or 'face_match'",
      },
      { status: 400 },
    );
  }

  const vkey = await getCircuitVerificationKey(circuitType);
  return NextResponse.json({
    circuitType,
    ...vkey,
  });
}

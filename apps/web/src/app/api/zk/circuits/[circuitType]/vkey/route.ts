import { type NextRequest, NextResponse } from "next/server";

import { getCircuitVerificationKey } from "@/lib/privacy/zk/noir/verifier";
import { isProofType, ProofType } from "@/lib/privacy/zk/proof-types";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ circuitType: string }> }
) {
  const { circuitType } = await context.params;
  if (!isProofType(circuitType)) {
    return NextResponse.json(
      {
        error: `circuitType must be one of: ${Object.values(ProofType).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const vkey = await getCircuitVerificationKey(circuitType);
  return NextResponse.json({
    circuitType,
    ...vkey,
  });
}

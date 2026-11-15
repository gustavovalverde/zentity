import { NextResponse } from "next/server";

import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import {
  getBbJsVersion,
  getCircuitIdentity,
} from "@/lib/privacy/zk/noir/verifier";
import { PROOF_TYPE_SPECS, ProofType } from "@/lib/privacy/zk/proof-types";

export async function GET(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const bbVersion = getBbJsVersion();
  const circuits = await Promise.all(
    Object.values(ProofType).map(
      async (circuit) =>
        [
          circuit,
          {
            ...(await getCircuitIdentity(circuit)),
            spec: PROOF_TYPE_SPECS[circuit],
          },
        ] as const
    )
  );

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    bbVersion,
    circuits: Object.fromEntries(circuits),
  });
}

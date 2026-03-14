import { NextResponse } from "next/server";

import {
  attachRequestContextToSpan,
  resolveRequestContext,
} from "@/lib/observability/request-context";
import {
  getBbJsVersion,
  getCircuitIdentity,
} from "@/lib/privacy/zk/noir-verifier";
import { PROOF_TYPE_SPECS } from "@/lib/privacy/zk/proof-types";

export async function GET(request: Request) {
  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const bbVersion = getBbJsVersion();
  const [age, docValidity, nationality, faceMatch] = await Promise.all([
    getCircuitIdentity("age_verification"),
    getCircuitIdentity("doc_validity"),
    getCircuitIdentity("nationality_membership"),
    getCircuitIdentity("face_match"),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    bbVersion,
    circuits: {
      age_verification: {
        ...age,
        spec: PROOF_TYPE_SPECS.age_verification,
      },
      doc_validity: {
        ...docValidity,
        spec: PROOF_TYPE_SPECS.doc_validity,
      },
      nationality_membership: {
        ...nationality,
        spec: PROOF_TYPE_SPECS.nationality_membership,
      },
      face_match: {
        ...faceMatch,
        spec: PROOF_TYPE_SPECS.face_match,
      },
    },
  });
}

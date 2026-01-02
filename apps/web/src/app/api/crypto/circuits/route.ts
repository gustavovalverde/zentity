import { NextResponse } from "next/server";

import { getBbJsVersion, getCircuitIdentity } from "@/lib/zk/noir-verifier";
import { CIRCUIT_SPECS } from "@/lib/zk/zk-circuit-spec";

export async function GET() {
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
        spec: CIRCUIT_SPECS.age_verification,
      },
      doc_validity: {
        ...docValidity,
        spec: CIRCUIT_SPECS.doc_validity,
      },
      nationality_membership: {
        ...nationality,
        spec: CIRCUIT_SPECS.nationality_membership,
      },
      face_match: {
        ...faceMatch,
        spec: CIRCUIT_SPECS.face_match,
      },
    },
  });
}

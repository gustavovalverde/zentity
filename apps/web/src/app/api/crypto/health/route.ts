import { NextResponse } from "next/server";
import { getBbJsVersion, getCircuitMetadata } from "@/lib/noir-verifier";
import { getFheServiceUrl } from "@/lib/service-urls";

const FHE_SERVICE_URL = getFheServiceUrl();

async function checkService(url: string, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export async function GET() {
  const fheHealth = await checkService(FHE_SERVICE_URL);

  const zk = {
    bbVersion: getBbJsVersion(),
    circuits: {
      age_verification: getCircuitMetadata("age_verification"),
      doc_validity: getCircuitMetadata("doc_validity"),
      nationality_membership: getCircuitMetadata("nationality_membership"),
      face_match: getCircuitMetadata("face_match"),
    },
  };

  const allHealthy = fheHealth?.status === "ok" && Boolean(zk.bbVersion);

  return NextResponse.json({
    fhe: fheHealth,
    zk,
    allHealthy,
  });
}

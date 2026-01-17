import {
  getBbJsVersion,
  getCircuitMetadata,
  prewarmVerificationKeys,
} from "@/lib/privacy/zk/noir-verifier";
import { getFheServiceUrl } from "@/lib/utils/service-urls";

import { publicProcedure } from "../../server";

const FHE_SERVICE_URL = getFheServiceUrl();

async function checkServiceUncached(
  url: string,
  timeoutMs = 5000
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: {
        "X-Zentity-Healthcheck": "true",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function checkService(url: string, timeoutMs = 5000): Promise<unknown> {
  const { unstable_cache } = await import("next/cache");
  const cachedCheck = unstable_cache(
    () => checkServiceUncached(url, timeoutMs),
    [`health-check-${url}`],
    { revalidate: 15 }
  );
  return cachedCheck();
}

/**
 * Health check for crypto subsystems.
 * Returns status of FHE service and available ZK circuits.
 */
export const healthProcedure = publicProcedure.query(async () => {
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

  const allHealthy =
    (fheHealth as { status?: unknown } | null)?.status === "ok" &&
    Boolean(zk.bbVersion);

  if (allHealthy) {
    prewarmVerificationKeys().catch(() => {
      // Best-effort: warm cache without impacting health response.
    });
  }

  return {
    fhe: fheHealth,
    zk,
    allHealthy,
  };
});

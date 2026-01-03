/**
 * Service Warmup Utility
 *
 * Proactively checks backend service health at server startup to:
 * 1. Establish HTTP connections early (connection pooling)
 * 2. Verify services are reachable before first user request
 * 3. Log service status for observability
 *
 * Called from instrumentation.ts during Next.js server initialization.
 */

import "server-only";

import { logger } from "@/lib/logging/logger";
import { getFheServiceUrl, getOcrServiceUrl } from "@/lib/utils/service-urls";

interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  durationMs: number;
  error?: string;
}

async function checkServiceHealth(
  name: string,
  url: string,
  timeoutMs = 5000
): Promise<ServiceHealth> {
  const startTime = Date.now();
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

    return {
      name,
      url,
      healthy: response.ok,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      name,
      url,
      healthy: false,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Warm up backend service connections at server startup.
 * Non-blocking on failure - logs warning but doesn't fail startup.
 */
export async function warmupServices(): Promise<void> {
  const startTime = Date.now();

  const results = await Promise.allSettled([
    checkServiceHealth("FHE", getFheServiceUrl()),
    checkServiceHealth("OCR", getOcrServiceUrl()),
  ]);

  const services = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { name: "unknown", url: "", healthy: false, durationMs: 0 }
  );

  const allHealthy = services.every((s) => s.healthy);
  const unhealthy = services.filter((s) => !s.healthy);

  if (allHealthy) {
    logger.info(
      {
        durationMs: Date.now() - startTime,
        services: services.map((s) => ({
          name: s.name,
          healthy: s.healthy,
          durationMs: s.durationMs,
        })),
      },
      "Backend services health check complete"
    );
  } else {
    logger.warn(
      {
        durationMs: Date.now() - startTime,
        services: services.map((s) => ({
          name: s.name,
          healthy: s.healthy,
          durationMs: s.durationMs,
          error: s.error,
        })),
        unhealthyServices: unhealthy.map((s) => s.name),
      },
      "Some backend services are unavailable"
    );
  }
}

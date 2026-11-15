import "server-only";

import type { NodeSDK } from "@opentelemetry/sdk-node";

import { createHash } from "node:crypto";

import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

import { env } from "@/env";

let sdk: NodeSDK | null = null;

const SIGNAL_PATH_SUFFIX = /\/v1\/(?:traces|metrics|logs)\/?$/;

export function getServiceName(): string {
  return env.OTEL_SERVICE_NAME;
}

export function getServiceVersion(): string {
  return (
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.npm_package_version ||
    "0.0.0"
  );
}

function getEnvironmentName(): string {
  return env.NEXT_PUBLIC_APP_ENV ?? env.NODE_ENV;
}

// Without this gate the SDK would export to its http://localhost:4318 default
// in every environment.
function telemetryEnabled(): boolean {
  return (
    env.OTEL_ENABLED === true ||
    Boolean(
      env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
    )
  );
}

/**
 * Starts the OpenTelemetry Node SDK. Exporters, endpoints, headers, protocol,
 * and the metric export interval come from the standard `OTEL_*` variables.
 * Logs are not exported: Pino writes them to stdout, and the Pino
 * instrumentation only adds trace context to each record.
 */
export async function initTelemetry(): Promise<void> {
  if (sdk || !telemetryEnabled()) {
    return;
  }

  const [
    { getNodeAutoInstrumentations },
    { defaultResource, resourceFromAttributes },
    { NodeSDK },
    { ATTR_DEPLOYMENT_ENVIRONMENT_NAME, ATTR_SERVICE_VERSION },
  ] = await Promise.all([
    import("@opentelemetry/auto-instrumentations-node"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/semantic-conventions"),
  ]);

  sdk = new NodeSDK({
    serviceName: getServiceName(),
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_VERSION]: getServiceVersion(),
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: getEnvironmentName(),
      })
    ),
    logRecordProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? "";
            return (
              url.startsWith("/_next") ||
              url.startsWith("/favicon") ||
              url.startsWith("/robots.txt") ||
              url.startsWith("/api/status/health") ||
              url.startsWith("/api/zk/health") ||
              url.startsWith("/api/password/pwned") ||
              url.startsWith("/api/status/metrics/client") ||
              url.startsWith("/api/status/build-info") ||
              url.startsWith("/api/confidential/relayer") ||
              url.startsWith("/health")
            );
          },
        },
        "@opentelemetry/instrumentation-pino": { disableLogSending: true },
      }),
    ],
  });

  sdk.start();

  // The SDK appends /v1/<signal> to OTEL_EXPORTER_OTLP_ENDPOINT, so a full
  // signal URL exports to paths the collector rejects, with no error logged.
  if (SIGNAL_PATH_SUFFIX.test(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "")) {
    const { logger } = await import("@/lib/logging/logger");
    logger.warn(
      "OTEL_EXPORTER_OTLP_ENDPOINT ends in a signal path. Set it to the collector base URL (for example http://otel-collector:4318), or move the full URL to OTEL_EXPORTER_OTLP_TRACES_ENDPOINT."
    );
  }

  const shutdown = () => {
    sdk?.shutdown().catch(() => {
      // Shutdown failure is non-critical; process exit is acceptable
    });
    sdk = null;
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/**
 * Runs `run` inside an active span. A throw marks the span ERROR; otherwise
 * the status stays unset, which OpenTelemetry treats as success. The SDK drops
 * attributes whose value is `undefined`.
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T> | T
): Promise<T> {
  const tracer = trace.getTracer(getServiceName());
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "span failed",
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

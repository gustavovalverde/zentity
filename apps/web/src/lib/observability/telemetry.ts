import "server-only";

import type { NodeSDK } from "@opentelemetry/sdk-node";

import { createHash } from "node:crypto";

import {
  type Attributes,
  context,
  propagation,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

import { env } from "@/env";

let sdk: NodeSDK | null = null;

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

  const shutdown = () => {
    sdk?.shutdown().catch(() => {
      // Shutdown failure is non-critical; process exit is acceptable
    });
    sdk = null;
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function injectTraceHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const carrier: Record<string, string> = { ...headers };
  propagation.inject(context.active(), carrier, {
    set: (target, key, value) => {
      target[key] = String(value);
    },
  });
  return carrier;
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

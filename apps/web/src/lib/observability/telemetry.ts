import "server-only";

import { createHash } from "node:crypto";

import {
  context,
  type Span,
  type SpanAttributes,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";

let sdk: NodeSDK | null = null;

function parseHeaders(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;

  const headers: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) continue;
    const trimmedKey = key.trim();
    const value = rest.join("=").trim();
    if (!trimmedKey || !value) continue;
    headers[trimmedKey] = value;
  }

  return Object.keys(headers).length ? headers : undefined;
}

function getServiceName(): string {
  return process.env.OTEL_SERVICE_NAME || "zentity-web";
}

function getServiceVersion(): string {
  return (
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.npm_package_version ||
    "0.0.0"
  );
}

function getEnvironmentName(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  );
}

export function telemetryEnabled(): boolean {
  return (
    process.env.OTEL_ENABLED === "true" ||
    Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  );
}

export function initTelemetry(): void {
  if (sdk) return;
  if (!telemetryEnabled()) return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT;
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers,
  });

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: getServiceName(),
      [ATTR_SERVICE_VERSION]: getServiceVersion(),
      "deployment.environment": getEnvironmentName(),
    }),
  );

  sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? "";
            return (
              url.startsWith("/_next") ||
              url.startsWith("/favicon") ||
              url.startsWith("/robots.txt") ||
              url.startsWith("/api/health") ||
              url.startsWith("/health")
            );
          },
        },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    void sdk?.shutdown();
    sdk = null;
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function getTracer() {
  return trace.getTracer(getServiceName());
}

export function currentSpan(): Span | undefined {
  return trace.getSpan(context.active()) ?? undefined;
}

export function addSpanEvent(name: string, attributes?: SpanAttributes): void {
  const span = currentSpan();
  if (!span) return;
  if (!attributes) {
    span.addEvent(name);
    return;
  }

  const filtered = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  ) as SpanAttributes;
  span.addEvent(name, filtered);
}

export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  run: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = getTracer();
  const filtered = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  ) as SpanAttributes;
  return tracer.startActiveSpan(
    name,
    { attributes: filtered },
    async (span) => {
      try {
        const result = await run(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
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
    },
  );
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

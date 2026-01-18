# RFC-0006: Observability with OpenTelemetry

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2024-12-29 |
| **Updated** | 2025-12-30 |
| **Author** | Gustavo Valverde |

## Summary

Add distributed tracing across Zentity services (Web, FHE, OCR) using OpenTelemetry OTLP exporters (collector-first), with auto-instrumentation plus domain spans for onboarding, FHE payload sizing, and async identity finalization to make performance bottlenecks and duplicate work visible.

## Problem Statement

Currently, there is no observability infrastructure:

1. **No Distributed Tracing**: Requests flow across Web → FHE → OCR services with no visibility:

   ```text
   User Request → Next.js → FHE Service → ???
                         ↘ OCR Service → ???
   ```

   When failures occur, no way to trace which service failed or why.

2. **No Request Latency Metrics**: No data on:
   - Average response times
   - P95/P99 latency percentiles
   - Slow endpoint identification

3. **No Database Query Performance**: 109 database queries with no visibility into execution time.

4. **No Service Dependencies**: No visualization of how services depend on each other.

5. **Black Box Debugging**: Errors are logged but context is lost across service boundaries.

## Design Decisions

- **Tracing Standard**: OpenTelemetry (OTel)
  - Vendor-neutral CNCF standard
  - Wide ecosystem support
  - Works with any backend (Jaeger, Zipkin, Datadog, etc.)
  - SDKs for JavaScript/TypeScript and Rust

- **Trace Backend**: OTLP-first (collector recommended)
  - Use OpenTelemetry Collector in production (vendor-neutral fan-out)
  - Local dev can point directly to Jaeger/Tempo via OTLP HTTP
  - No external data sharing required (self-hosted)
  - Backend is swappable (Jaeger, Tempo, Honeycomb, Datadog, etc.)

- **Instrumentation Scope**:
- tRPC procedures (automatic spans)
- HTTP client calls (fetch to FHE/OCR)
- Database queries (future: Drizzle/SQLite instrumentation)
- Background jobs (DB-backed identity_verification_jobs)

## Architecture Overview

### Tracing Flow

```text
┌─────────────────────────────────────────────────────────────────────┐
│                           Trace Flow                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Browser                                                             │
│    │                                                                 │
│    │ POST /api/trpc/identity.verify                                  │
│    │ trace-id: abc123                                                │
│    ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Next.js (Web)                                                 │   │
│  │   span: identity.verify (root)                                │   │
│  │     │                                                         │   │
│  │     ├─► span: db.select (identity_documents)                  │   │
│  │     │                                                         │   │
│  │     ├─► span: http.post (FHE /encrypt-age)                    │   │
│  │     │     └─► propagated to FHE service                       │   │
│  │     │                                                         │   │
│  │     └─► span: http.post (OCR /process)                        │   │
│  │           └─► propagated to OCR service                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                  │                        │
│                          ▼                  ▼                        │
│  ┌──────────────────────────┐  ┌───────────────────────────────┐   │
│  │ FHE Service (Rust)       │  │ OCR Service (Python)          │   │
│  │   span: encrypt_age      │  │   span: process_document      │   │
│  │     └─► span: tfhe_enc   │  │     └─► span: rapidocr        │   │
│  └──────────────────────────┘  └───────────────────────────────┘   │
│                                                                      │
│  All spans share trace-id: abc123                                   │
│  Visualized in trace backend UI                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### New Structure

```text
src/lib/observability/
├── telemetry.ts            # OpenTelemetry SDK setup
└── index.ts                # Public API
```

### OpenTelemetry Setup

```typescript
// src/lib/observability/telemetry.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces";

export function initTelemetry(): void {
  if (
    process.env.OTEL_ENABLED !== "true" &&
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ) {
    return;
  }

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "zentity-web",
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
        [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? "development",
      }),
    ),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}
```

### Next.js Instrumentation

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("@/lib/observability");
    initTelemetry();
  }
}
```

### tRPC Tracing Middleware

```typescript
// src/lib/trpc/server.ts
import { middleware } from "@trpc/server";
import { SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./telemetry";

export const withTracing = middleware(async ({ path, type, input, ctx, next }) => {
  const tracer = getTracer();

  return tracer.startActiveSpan(
    `trpc.${path}`,
    {
      attributes: {
        "rpc.system": "trpc",
        "rpc.method": path,
        "rpc.type": type,
        "request.id": ctx.requestId,
      },
    },
    async (span) => {
      try {
        const result = await next({
          ctx: {
            ...ctx,
            span, // Make span available to procedures
          },
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } finally {
        span.end();
      }
    },
  );
});
```

### Instrumented Service Calls

```typescript
// src/lib/crypto/fhe-client.ts
import { withSpan } from "@/lib/observability";

const payload = JSON.stringify({ serverKey });
return withSpan(
  "fhe.register_key",
  { "fhe.operation": "register_key", "fhe.request_bytes": payload.length },
  () =>
    fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
);
```

Node auto-instrumentation handles HTTP client spans and trace propagation; domain spans add payload sizing and operation labels.

### Database Tracing

```typescript
// src/lib/db/connection.ts (updated)
import { trace } from "@opentelemetry/api";
import { getTracer } from "@/lib/observability";

// Wrap Drizzle queries with tracing
function wrapWithTracing<T>(
  operation: string,
  table: string,
  fn: () => T
): T {
  const tracer = getTracer();

  return tracer.startActiveSpan(
    `db.${operation}`,
    {
      attributes: {
        "db.system": "sqlite",
        "db.operation": operation,
        "db.table": table,
      },
    },
    (span) => {
      try {
        const result = fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
```

### Usage in Services

```typescript
// src/lib/fhe-client.ts (updated)
import { tracedFetch } from "@/lib/observability";

async function callFheService(endpoint: string, data: unknown) {
  const url = `${FHE_SERVICE_URL}${endpoint}`;

  // Trace context automatically propagated
  const response = await tracedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  return response.json();
}
```

### Docker Compose Addition

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/jaeger:2.13.0
    command:
      - --set=receivers.otlp.protocols.http.endpoint=0.0.0.0:4318
      - --set=receivers.otlp.protocols.grpc.endpoint=0.0.0.0:4317
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
      - "4317:4317"    # OTLP gRPC
    networks:
      - zentity-network
```

### Span Attributes Convention

```typescript
// Standard attributes used across services
const spanAttributes = {
  // User context (hashed for privacy)
  "user.id": hashUserId(userId), // SHA-256 prefix

  // tRPC context
  "trpc.path": "identity.verify",
  "trpc.type": "mutation",

  // HTTP context
  "http.method": "POST",
  "http.url": "http://fhe:5001/encrypt-age",
  "http.status_code": 200,

  // Database context
  "db.system": "sqlite",
  "db.operation": "select",
  "db.table": "identity_documents",

  // FHE context
  "fhe.operation": "encrypt",
  "fhe.attribute": "dob_days",

  // Error context
  "error.type": "FheServiceError",
  "error.message": "Connection refused",
};
```

### Privacy-Safe Tracing

```typescript
// Never include PII in spans
span.setAttributes({
  // Good - hashed identifier
  "user.id": hashUserId(userId),

  // Good - operation type
  "document.type": "passport",

  // Bad - never do this
  // "user.email": email,
  // "user.name": name,
  // "document.number": docNumber,
});

// Use span events for state transitions, not PII
span.addEvent("document_validated");
span.addEvent("age_proof_generated");
```

## Implementation Steps

### Step 1: Add Dependencies

```bash
cd apps/web
bun add @opentelemetry/sdk-node \
        @opentelemetry/auto-instrumentations-node \
        @opentelemetry/api \
        @opentelemetry/exporter-trace-otlp-http \
        @opentelemetry/resources \
        @opentelemetry/semantic-conventions
```

### Step 2: Create Tracing Module

Create `src/lib/observability/telemetry.ts` with SDK setup.

### Step 3: Add Next.js Instrumentation

Create `src/instrumentation.ts` to initialize tracing at startup.

### Step 4: Create tRPC Middleware

Add tracing middleware in `src/lib/trpc/server.ts` for procedure tracing.

### Step 5: Update tRPC Base

Add tracing middleware to procedure chain:

```typescript
export const publicProcedure = t.procedure
  .use(withTracing)
  .use(withLogging);
```

### Step 6: Add FHE + OCR Instrumentation

- **FHE (Rust)**: `opentelemetry-otlp` + `tracing-opentelemetry` with OTLP HTTP exporter
- **OCR (Python)**: `opentelemetry-instrumentation-fastapi` + OTLP HTTP exporter

### Auto-Instrumentation Notes

- **Node.js**: Prefer `@opentelemetry/auto-instrumentations-node` for baseline HTTP/fetch spans.
- **Python**: `opentelemetry-instrument` can auto-instrument, but programmatic setup is more deterministic for containerized deployments.

### Step 7: Update FHE/OCR Clients

Replace `fetch` with `tracedFetch` in service clients.

### Step 8: Add an OTLP Backend (Optional)

Add a local OTLP backend (Jaeger/Tempo/Collector) for development.

### Step 9: Add Environment Variables

```bash
# .env.example
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/observability/telemetry.ts` | Create | OTel SDK setup |
| `apps/web/src/lib/observability/index.ts` | Create | Public API |
| `apps/web/src/instrumentation.ts` | Create | Next.js instrumentation |
| `apps/web/src/lib/trpc/server.ts` | Modify | Attach tracing middleware + user hash |
| `apps/web/src/lib/crypto/fhe-client.ts` | Modify | FHE spans + payload sizing |
| `apps/web/src/lib/document/ocr-client.ts` | Modify | OCR spans + payload sizing |
| `apps/web/src/lib/db/onboarding-session.ts` | Modify | Onboarding progress events |
| `apps/fhe/src/telemetry.rs` | Create | OTLP exporter + resource tags |
| `apps/fhe/src/main.rs` | Modify | Trace propagation + shutdown |
| `apps/ocr/src/ocr_service/telemetry.py` | Create | OTEL provider + FastAPI instrumentation |
| `apps/ocr/src/ocr_service/main.py` | Modify | Hook telemetry |
| `apps/ocr/src/ocr_service/api/process.py` | Modify | Manual OCR span |
| `apps/ocr/pyproject.toml` | Modify | OTel dependencies |
| `apps/fhe/Cargo.toml` | Modify | OTel crates |
| `docker-compose.yml` | Modify | OTEL envs |
| `apps/web/.env.example` | Modify | OTEL envs |

## Security/Privacy Considerations

1. **No PII in Spans**: User IDs are hashed, no emails/names/documents
2. **Self-Hosted Only**: OTLP collector/backends stay on your infrastructure
3. **Sampling**: Can reduce trace volume to minimize stored data
4. **Trace Retention**: Configure backend to auto-delete old traces
5. **Internal Network**: Collector/UI endpoints should not be publicly exposed

## Technical Notes

- **Trace Propagation**: Uses W3C Trace Context standard (traceparent header)
- **Sampling**: Start with 100% sampling, reduce if volume is high
- **Span Limits**: Max 128 attributes, 128 events per span (configurable)
- **Async Context**: Node.js AsyncLocalStorage used for context propagation
- **Performance**: ~1% overhead for tracing (negligible)

## Future Enhancements

1. **Metrics**: Add Prometheus metrics alongside traces
2. **DB Instrumentation**: Add Drizzle/SQLite spans and query metrics
3. **Client RUM**: Optional browser spans for step timing and UX latency
4. **Dashboards**: Grafana dashboards for service health
5. **Alerting**: Alert on high error rates or latency

## Package Changes

```json
{
  "dependencies": {
    "@opentelemetry/sdk-node": "^0.208.0",
    "@opentelemetry/auto-instrumentations-node": "^0.67.3",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.208.0",
    "@opentelemetry/resources": "^2.2.0",
    "@opentelemetry/semantic-conventions": "^1.38.0"
  }
}
```

```toml
# apps/ocr/pyproject.toml
opentelemetry-api = "1.39.1"
opentelemetry-sdk = "1.39.1"
opentelemetry-exporter-otlp = "1.39.1"
opentelemetry-instrumentation-fastapi = "0.60b1"
opentelemetry-instrumentation-requests = "0.60b1"
opentelemetry-instrumentation-httpx = "0.60b1"
```

```toml
# apps/fhe/Cargo.toml
opentelemetry = "0.31.0"
opentelemetry-otlp = "0.31.0"
opentelemetry_sdk = "0.31.0"
tracing-opentelemetry = "0.32.0"
opentelemetry-semantic-conventions = "0.31.0"
```

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [Next.js Instrumentation](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

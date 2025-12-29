# RFC-0006: Observability with OpenTelemetry

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Add distributed tracing across Zentity services (Web, FHE, OCR) using OpenTelemetry with self-hosted Jaeger for trace visualization, enabling performance debugging and request flow analysis.

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

- **Trace Backend**: Jaeger (self-hosted)
  - CNCF graduated project
  - Self-hosted on Docker/Railway
  - No external data sharing (privacy-first)
  - Web UI for trace visualization
  - Supports sampling strategies

- **Instrumentation Scope**:
  - tRPC procedures (automatic spans)
  - HTTP client calls (fetch to FHE/OCR)
  - Database queries (Drizzle instrumentation)
  - Background jobs (BullMQ workers)

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
│  Visualized in Jaeger UI                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### New Structure

```text
src/lib/telemetry/
├── tracing.ts              # OpenTelemetry SDK setup
├── middleware.ts           # tRPC tracing middleware
├── http.ts                 # Instrumented fetch wrapper
└── index.ts                # Public API
```

### OpenTelemetry Setup

```typescript
// src/lib/telemetry/tracing.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

const JAEGER_ENDPOINT = process.env.JAEGER_ENDPOINT || "http://localhost:4318/v1/traces";
const SERVICE_NAME = "zentity-web";
const SERVICE_VERSION = process.env.npm_package_version || "0.0.0";

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (sdk) return; // Already initialized

  const exporter = new OTLPTraceExporter({
    url: JAEGER_ENDPOINT,
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    }),
    spanProcessor: new SimpleSpanProcessor(exporter),
    instrumentations: [
      new HttpInstrumentation({
        // Don't trace internal requests
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || "";
          return url.includes("/_next") || url.includes("/health");
        },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown
  process.on("SIGTERM", () => sdk?.shutdown());
}

export function getTracer() {
  return require("@opentelemetry/api").trace.getTracer(SERVICE_NAME);
}
```

### Next.js Instrumentation

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTracing } = await import("@/lib/telemetry/tracing");
    initTracing();
  }
}
```

### tRPC Tracing Middleware

```typescript
// src/lib/telemetry/middleware.ts
import { middleware } from "@trpc/server";
import { trace, SpanStatusCode, context } from "@opentelemetry/api";
import { getTracer } from "./tracing";

export const tracingMiddleware = middleware(async ({ path, type, next, ctx }) => {
  const tracer = getTracer();

  return tracer.startActiveSpan(
    `trpc.${path}`,
    {
      attributes: {
        "trpc.path": path,
        "trpc.type": type,
        "user.id": ctx.userId || "anonymous",
      },
    },
    async (span) => {
      try {
        const result = await next({
          ctx: {
            ...ctx,
            span, // Make span available to procedure
          },
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    }
  );
});
```

### Instrumented Fetch Wrapper

```typescript
// src/lib/telemetry/http.ts
import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./tracing";

/**
 * Fetch wrapper that propagates trace context to downstream services
 */
export async function tracedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const tracer = getTracer();
  const parsedUrl = new URL(url);

  return tracer.startActiveSpan(
    `http.${options.method || "GET"} ${parsedUrl.pathname}`,
    {
      attributes: {
        "http.url": url,
        "http.method": options.method || "GET",
        "http.host": parsedUrl.host,
      },
    },
    async (span) => {
      // Inject trace context into headers
      const headers = new Headers(options.headers);
      propagation.inject(context.active(), headers, {
        set: (carrier, key, value) => carrier.set(key, value),
      });

      try {
        const response = await fetch(url, {
          ...options,
          headers,
        });

        span.setAttributes({
          "http.status_code": response.status,
        });

        if (response.ok) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${response.status}`,
          });
        }

        return response;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Fetch failed",
        });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
```

### Database Tracing

```typescript
// src/lib/db/connection.ts (updated)
import { trace } from "@opentelemetry/api";
import { getTracer } from "@/lib/telemetry";

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
import { tracedFetch } from "@/lib/telemetry";

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
    image: jaegertracing/all-in-one:latest
    container_name: zentity-jaeger
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
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
  "fhe.attribute": "birth_year_offset",

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
        @opentelemetry/api \
        @opentelemetry/exporter-trace-otlp-http \
        @opentelemetry/instrumentation-http \
        @opentelemetry/resources \
        @opentelemetry/semantic-conventions
```

### Step 2: Create Tracing Module

Create `src/lib/telemetry/tracing.ts` with SDK setup.

### Step 3: Add Next.js Instrumentation

Create `src/instrumentation.ts` to initialize tracing at startup.

### Step 4: Create tRPC Middleware

Create `src/lib/telemetry/middleware.ts` for procedure tracing.

### Step 5: Create Traced Fetch

Create `src/lib/telemetry/http.ts` for outbound HTTP tracing.

### Step 6: Update tRPC Base

Add tracing middleware to procedure chain:

```typescript
export const publicProcedure = t.procedure
  .use(loggingMiddleware)
  .use(tracingMiddleware);
```

### Step 7: Update FHE/OCR Clients

Replace `fetch` with `tracedFetch` in service clients.

### Step 8: Add Jaeger to Docker Compose

Add Jaeger service for local development.

### Step 9: Add Environment Variables

```bash
# .env.example
JAEGER_ENDPOINT=http://localhost:4318/v1/traces
```

### Step 10: (Future) Add Rust/Python Instrumentation

Add OpenTelemetry to FHE (Rust) and OCR (Python) services for end-to-end tracing.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/telemetry/tracing.ts` | Create | OTel SDK setup |
| `src/lib/telemetry/middleware.ts` | Create | tRPC middleware |
| `src/lib/telemetry/http.ts` | Create | Traced fetch |
| `src/lib/telemetry/index.ts` | Create | Public API |
| `src/instrumentation.ts` | Create | Next.js instrumentation |
| `src/lib/trpc/trpc.ts` | Modify | Add tracing middleware |
| `src/lib/fhe-client.ts` | Modify | Use traced fetch |
| `docker-compose.yml` | Modify | Add Jaeger service |
| `.env.example` | Modify | Add JAEGER_ENDPOINT |

## Security/Privacy Considerations

1. **No PII in Spans**: User IDs are hashed, no emails/names/documents
2. **Self-Hosted Only**: Jaeger runs on your infrastructure
3. **Sampling**: Can reduce trace volume to minimize stored data
4. **Trace Retention**: Configure Jaeger to auto-delete old traces
5. **Internal Network**: Jaeger UI should not be publicly exposed

## Technical Notes

- **Trace Propagation**: Uses W3C Trace Context standard (traceparent header)
- **Sampling**: Start with 100% sampling, reduce if volume is high
- **Span Limits**: Max 128 attributes, 128 events per span (configurable)
- **Async Context**: Node.js AsyncLocalStorage used for context propagation
- **Performance**: ~1% overhead for tracing (negligible)

## Future Enhancements

1. **Metrics**: Add Prometheus metrics alongside traces
2. **Rust Instrumentation**: Add tracing to FHE service
3. **Python Instrumentation**: Add tracing to OCR service
4. **Dashboards**: Grafana dashboards for service health
5. **Alerting**: Alert on high error rates or latency

## Package Changes

```json
{
  "dependencies": {
    "@opentelemetry/sdk-node": "^0.57.x",
    "@opentelemetry/api": "^1.9.x",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57.x",
    "@opentelemetry/instrumentation-http": "^0.57.x",
    "@opentelemetry/resources": "^1.29.x",
    "@opentelemetry/semantic-conventions": "^1.29.x"
  }
}
```

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [Next.js Instrumentation](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

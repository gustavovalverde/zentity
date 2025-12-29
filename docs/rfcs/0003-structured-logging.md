# RFC-0003: Structured Logging with Pino

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Replace ad-hoc `console.log` statements with Pino structured logging, adding request correlation, log levels, and privacy-safe PII scrubbing while keeping all data on-premises.

## Problem Statement

The current logging approach has significant gaps:

1. **Minimal Logging**: Only 3 instances of `console.log/warn` in the entire codebase:

   ```typescript
   // crypto.ts
   console.warn("Proof verification failed:", verifyResult.issues);

   // liveness.ts
   console.log("Baseline detection result:", detectionResult);
   console.log("Liveness score:", score);
   ```

2. **No Request Correlation**: Impossible to trace a request across tRPC procedures, FHE service calls, and database operations.

3. **No Log Levels**: Can't filter by severity (debug, info, warn, error) or enable verbose logging in development only.

4. **No Structured Format**: Plain text logs can't be queried, aggregated, or parsed by log management tools.

5. **No Error Context**: When errors occur, there's no surrounding context (request ID, user session, operation type).

## Design Decisions

- **Logger Choice**: Pino over Winston/Bunyan
  - Fastest Node.js logger (10x faster than Winston)
  - JSON output by default (structured)
  - Low memory overhead
  - Native Next.js support
  - Pretty-print for development

- **Privacy-First Approach**:
  - No external log aggregation service (Railway/Docker captures stdout)
  - PII scrubbing at source using existing `REDACT_KEYS` pattern
  - Correlation IDs are random UUIDs, not user identifiers
  - Never log: birth dates, nationalities, document numbers, face data

- **Log Levels**:
  - `error`: Operation failures, unhandled exceptions
  - `warn`: Degraded performance, validation failures
  - `info`: Request lifecycle, successful operations
  - `debug`: Detailed debugging (dev only)

## Architecture Overview

### New Structure

```text
src/lib/logging/
├── logger.ts               # Pino instance + configuration
├── middleware.ts           # tRPC logging middleware
├── error-logger.ts         # Centralized error capture with fingerprinting
├── redact.ts               # PII redaction utilities
└── index.ts                # Public API
```

### Logger Configuration

```typescript
// src/lib/logging/logger.ts
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),

  // Structured JSON in production, pretty-print in dev
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,

  // Base context for all logs
  base: {
    service: "zentity-web",
    version: process.env.npm_package_version,
  },

  // Redact sensitive fields
  redact: {
    paths: [
      "*.password",
      "*.secret",
      "*.token",
      "*.image",
      "*.documentImage",
      "*.faceData",
      "*.birthDate",
      "*.nationality",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },

  // Custom serializers
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      // Omit headers to avoid leaking cookies
    }),
    err: pino.stdSerializers.err,
  },
});

// Create child logger with request context
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
```

### Request Correlation

```typescript
// src/lib/logging/middleware.ts
import { middleware } from "@trpc/server";
import { createRequestLogger } from "./logger";
import { randomUUID } from "crypto";

export const loggingMiddleware = middleware(async ({ ctx, path, type, next }) => {
  const requestId = randomUUID();
  const log = createRequestLogger(requestId);
  const start = performance.now();

  log.info({ path, type }, "tRPC request started");

  try {
    const result = await next({
      ctx: { ...ctx, log, requestId },
    });

    const duration = performance.now() - start;
    log.info({ path, type, duration, ok: result.ok }, "tRPC request completed");

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    log.error({ path, type, duration, error }, "tRPC request failed");
    throw error;
  }
});
```

### Error Fingerprinting

```typescript
// src/lib/logging/error-logger.ts
import { createHash } from "crypto";
import { logger } from "./logger";

interface ErrorContext {
  requestId?: string;
  path?: string;
  userId?: string; // Optional - only if already authenticated
}

export function logError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(String(error));

  // Create fingerprint for grouping similar errors
  const fingerprint = createHash("sha256")
    .update(`${err.name}:${err.message}:${getStackLocation(err)}`)
    .digest("hex")
    .slice(0, 12);

  logger.error({
    ...context,
    fingerprint,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  }, `Error [${fingerprint}]: ${err.message}`);

  return fingerprint;
}

function getStackLocation(err: Error): string {
  const stack = err.stack?.split("\n")[1] || "";
  const match = stack.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
  return match ? `${match[2]}:${match[3]}` : "unknown";
}
```

### PII Redaction

```typescript
// src/lib/logging/redact.ts
// Extend existing REDACT_KEYS pattern from trpc/client.ts

const REDACT_KEYS = new Set([
  // Images and biometrics
  "image",
  "documentImage",
  "faceImage",
  "selfieImage",
  "faceDescriptor",
  "faceData",

  // PII fields
  "birthDate",
  "dateOfBirth",
  "dob",
  "nationality",
  "documentNumber",
  "firstName",
  "lastName",
  "fullName",

  // Credentials
  "password",
  "secret",
  "token",
  "privateKey",
  "clientKey",
]);

export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  depth = 0,
  seen = new WeakSet()
): T {
  if (depth > 10 || seen.has(obj)) return obj;
  seen.add(obj);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.startsWith("data:image")) {
      result[key] = "[BASE64_IMAGE]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>, depth + 1, seen);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
```

### Integration with tRPC

```typescript
// src/lib/trpc/trpc.ts
import { loggingMiddleware } from "@/lib/logging/middleware";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

// Add logging to all procedures
export const publicProcedure = t.procedure.use(loggingMiddleware);
export const protectedProcedure = t.procedure
  .use(loggingMiddleware)
  .use(authMiddleware);
```

### Usage in Routers

```typescript
// src/lib/trpc/routers/identity.ts
export const identityRouter = router({
  verify: protectedProcedure
    .input(verifyIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      const { log, requestId } = ctx;

      log.info({ documentType: input.documentType }, "Starting identity verification");

      try {
        const result = await processDocument(input.image);
        log.info({ documentId: result.id }, "Document processed successfully");
        return result;
      } catch (error) {
        // Error already logged by middleware, but add context
        log.error({ error, step: "document_processing" }, "Document processing failed");
        throw error;
      }
    }),
});
```

### Log Output Examples

**Development (pretty-printed):**

```text
[12:34:56.789] INFO (zentity-web): tRPC request started
    requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    path: "identity.verify"
    type: "mutation"

[12:34:57.123] INFO (zentity-web): Document processed successfully
    requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    documentId: "doc_abc123"

[12:34:57.456] INFO (zentity-web): tRPC request completed
    requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    path: "identity.verify"
    duration: 667
    ok: true
```

**Production (JSON):**

```json
{"level":30,"time":1703847296789,"service":"zentity-web","requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","path":"identity.verify","type":"mutation","msg":"tRPC request started"}
{"level":30,"time":1703847297123,"service":"zentity-web","requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","documentId":"doc_abc123","msg":"Document processed successfully"}
{"level":30,"time":1703847297456,"service":"zentity-web","requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","path":"identity.verify","duration":667,"ok":true,"msg":"tRPC request completed"}
```

## Implementation Steps

### Step 1: Add Dependencies

```bash
cd apps/web
bun add pino
bun add -D pino-pretty
```

### Step 2: Create Logger Module

Create `src/lib/logging/logger.ts` with Pino configuration.

### Step 3: Create Middleware

Create `src/lib/logging/middleware.ts` with tRPC logging middleware.

### Step 4: Create Error Logger

Create `src/lib/logging/error-logger.ts` with fingerprinting.

### Step 5: Create Redaction Utilities

Create `src/lib/logging/redact.ts` extending existing patterns.

### Step 6: Update tRPC Base

Modify `src/lib/trpc/trpc.ts` to include logging middleware.

### Step 7: Update Context Type

Add `log` and `requestId` to tRPC context:

```typescript
// src/lib/trpc/context.ts
import type { Logger } from "pino";

export interface Context {
  session: Session | null;
  log: Logger;
  requestId: string;
}
```

### Step 8: Replace console.log Calls

Update all existing `console.log/warn` to use structured logger:

| File | Current | New |
|------|---------|-----|
| `routers/crypto.ts` | `console.warn("Proof verification failed:", ...)` | `ctx.log.warn({ issues }, "Proof verification failed")` |
| `routers/liveness.ts` | `console.log("Baseline detection result:", ...)` | `ctx.log.debug({ result }, "Baseline detection result")` |
| `routers/liveness.ts` | `console.log("Liveness score:", ...)` | `ctx.log.info({ score }, "Liveness score calculated")` |

### Step 9: Add Environment Variable

```bash
# .env.example
LOG_LEVEL=debug  # debug, info, warn, error
```

### Step 10: Update Error Boundaries

Integrate error logger with React error boundaries:

```typescript
// src/app/error.tsx
import { logError } from "@/lib/logging";

export default function Error({ error, reset }) {
  useEffect(() => {
    logError(error, { path: "global-error-boundary" });
  }, [error]);
  // ...
}
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/logging/logger.ts` | Create | Pino instance + config |
| `src/lib/logging/middleware.ts` | Create | tRPC logging middleware |
| `src/lib/logging/error-logger.ts` | Create | Error fingerprinting |
| `src/lib/logging/redact.ts` | Create | PII redaction |
| `src/lib/logging/index.ts` | Create | Public API |
| `src/lib/trpc/trpc.ts` | Modify | Add logging middleware |
| `src/lib/trpc/context.ts` | Modify | Add log to context |
| `src/lib/trpc/routers/crypto.ts` | Modify | Replace console.warn |
| `src/lib/trpc/routers/liveness.ts` | Modify | Replace console.log |
| `src/app/error.tsx` | Modify | Add error logging |
| `.env.example` | Modify | Add LOG_LEVEL |

## Security/Privacy Considerations

1. **No PII in Logs**: Redaction at source prevents accidental exposure
2. **No External Services**: Logs stay on Railway/Docker - no third-party data sharing
3. **Request IDs are Random**: UUIDs can't be linked to users
4. **No Session Data**: Cookies and auth tokens redacted
5. **Image Data Blocked**: Base64 images detected and replaced
6. **Stack Traces in Errors Only**: Location info only in error level logs

## Technical Notes

- **Performance**: Pino is 10x faster than Winston - minimal overhead
- **Railway Integration**: JSON logs are automatically indexed by Railway
- **Future Enhancement**: Can add Grafana Loki for log aggregation if needed (self-hosted)
- **Log Rotation**: Railway handles log retention; no local rotation needed

## Package Changes

```json
{
  "dependencies": {
    "pino": "^9.x"
  },
  "devDependencies": {
    "pino-pretty": "^13.x"
  }
}
```

## References

- [Pino Documentation](https://getpino.io/)
- [Pino with Next.js](https://github.com/pinojs/pino/blob/main/docs/web.md)
- [tRPC Middleware](https://trpc.io/docs/server/middlewares)
- [Structured Logging Best Practices](https://www.datadoghq.com/blog/node-logging-best-practices/)

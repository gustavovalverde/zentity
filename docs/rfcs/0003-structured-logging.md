# RFC-0003: Structured Logging with Pino

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2024-12-29 |
| **Updated** | 2025-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Replace ad-hoc `console.log` statements with Pino structured logging, add request correlation across web + OCR + FHE services, and enforce privacy-safe PII scrubbing and client error reporting while keeping all data on-premises.

## Problem Statement

Prior to implementation, the logging approach had significant gaps:

1. **Minimal Logging**: Only 3 instances of `console.log/warn` in the entire codebase:

   ```typescript
   // crypto.ts
   console.warn("Proof verification failed:", verifyResult.issues);

   // liveness.ts
   console.log("Baseline detection result:", detectionResult);
   console.log("Liveness score:", score);
   ```

2. **No Request Correlation**: Impossible to trace a request across tRPC procedures, OCR/FHE service calls, and database operations.

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
apps/web/src/lib/logging/
├── logger.ts               # Pino instance + configuration
├── error-logger.ts         # Centralized error capture with fingerprinting
├── redact.ts               # PII redaction + message sanitization
└── index.ts                # Public API
```

### Logger Configuration

```typescript
// apps/web/src/lib/logging/logger.ts
import pino from "pino";
import { REDACT_KEYS } from "./redact";

const isDev = process.env.NODE_ENV !== "production";
const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-zentity-internal-token"]',
  ...Array.from(REDACT_KEYS, (key) => `*.${key}`),
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
  base: {
    service: "zentity-web",
    env: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  serializers: {
    req: (req) => ({ method: req.method, url: new URL(req.url).pathname }),
    err: pino.stdSerializers.err,
  },
});

// Create child logger with request context (no user identifiers)
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}
```

### Request Correlation

```typescript
// apps/web/src/lib/trpc/server.ts
export async function createTrpcContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({ headers: req.headers });
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    randomUUID();

  return { req, session: session ?? null, requestId };
}

const withLogging = trpc.middleware(async ({ ctx, path, type, input, next }) => {
  const log = createRequestLogger(ctx.requestId);
  const inputMeta = extractInputMeta(input);
  const start = performance.now();

  log.info({ path, type, ...inputMeta }, "tRPC request");

  try {
    const result = await next({ ctx: { ...ctx, log, debug: isDebugEnabled() } });
    log.info({ path, ok: true }, "tRPC complete");
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    logError(error, { requestId: ctx.requestId, path, duration }, log);
    throw error;
  }
});
```

**Cross-service propagation**

- Web → OCR/FHE clients include `X-Request-Id` on outbound calls.
- OCR service logs include `request_id` via middleware and logging filter.
- FHE service includes `request_id` on tracing spans via `TraceLayer`.

### Error Fingerprinting

```typescript
// apps/web/src/lib/logging/error-logger.ts
import { createHash } from "node:crypto";
import { logger } from "./logger";
import { sanitizeLogMessage } from "./redact";

interface ErrorContext {
  requestId?: string;
  path?: string;
  operation?: string;
  duration?: number;
}

export function logError(error: unknown, context: ErrorContext = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  const safeMessage = sanitizeLogMessage(err.message);
  const fingerprint = createHash("sha256")
    .update(`${err.name}:${safeMessage}:${getStackLocation(err)}`)
    .digest("hex")
    .slice(0, 12);

  logger.error(
    {
      ...context,
      fingerprint,
      error: {
        name: err.name,
        message: safeMessage,
        stack: err.stack?.replace(err.message, safeMessage),
      },
    },
    `[${fingerprint}] ${safeMessage}`,
  );

  return fingerprint;
}
```

### PII Redaction

```typescript
// apps/web/src/lib/logging/redact.ts
export const REDACT_KEYS = new Set([
  "image",
  "documentImage",
  "selfieImage",
  "baselineImage",
  "frameData",
  "idImage",
  "faceData",
  "faceDescriptor",
  "embedding",
  "birthDate",
  "dateOfBirth",
  "dob",
  "nationality",
  "nationalityCode",
  "documentNumber",
  "firstName",
  "lastName",
  "fullName",
  "password",
  "secret",
  "token",
  "privateKey",
  "clientKey",
  "serverKey",
  "publicKey",
  "fhePublicKey",
  "ciphertext",
  "userSalt",
]);

export function sanitizeLogMessage(message: string): string {
  // Redacts emails, long numbers, long hex values, and data URLs.
}

export function sanitizeForLog(value: unknown): unknown {
  // Handles circular refs, depth limits, base64 detection, and key redaction.
}
```

### Integration with tRPC

```typescript
// apps/web/src/lib/trpc/server.ts
const trpc = initTRPC.context<TrpcContext>().create();

export const publicProcedure = trpc.procedure.use(withLogging);
export const protectedProcedure = trpc.procedure
  .use(withLogging)
  .use(enforceAuth);
```

### Usage in Routers

```typescript
// apps/web/src/lib/trpc/routers/liveness.ts
if (ctx.debug) {
  ctx.log.debug(
    { stage: "baseline", faceDetected: true, challengeCount: input.challenges.length },
    "Liveness baseline processed",
  );
}
```

### Log Output Examples

**Development (pretty-printed):**

```text
[12:34:56.789] INFO (zentity-web): tRPC request
    requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    path: "identity.verify"
    type: "mutation"

[12:34:57.456] INFO (zentity-web): tRPC complete
    requestId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    path: "identity.verify"
    ok: true
```

**Production (JSON):**

```json
{"level":30,"time":1703847296789,"service":"zentity-web","requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","path":"identity.verify","type":"mutation","msg":"tRPC request"}
{"level":30,"time":1703847297456,"service":"zentity-web","requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","path":"identity.verify","ok":true,"msg":"tRPC complete"}
```

## Implementation (as shipped)

- Added Pino logger module with shared redaction + message sanitization.
- Request correlation is generated in `createTrpcContext`, logged in `withLogging`, and propagated to OCR/FHE via `X-Request-Id`.
- Client error boundary posts to `/api/log-client-error`; production omits message/stack.
- OCR service logs include `request_id` and mask IPs in auth warnings.
- FHE service trace spans include `request_id`.
- Server-side console logging in liveness frame endpoint replaced with Pino.
- Liveness debug flag removed from API payload; UI debug overlay gated by `NEXT_PUBLIC_DEBUG`.
- Tests added for redaction, error logging, request-id propagation, and client error route.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/lib/logging/logger.ts` | Create | Pino instance + config |
| `apps/web/src/lib/logging/error-logger.ts` | Create | Error fingerprinting + sanitization |
| `apps/web/src/lib/logging/redact.ts` | Create | PII redaction + message sanitization |
| `apps/web/src/lib/logging/index.ts` | Create | Public API |
| `apps/web/src/lib/trpc/server.ts` | Modify | Request correlation + logging middleware |
| `apps/web/src/lib/trpc/routers/crypto.ts` | Modify | Propagate requestId to FHE |
| `apps/web/src/lib/trpc/routers/identity.ts` | Modify | Propagate requestId to OCR/FHE |
| `apps/web/src/lib/trpc/routers/liveness.ts` | Modify | Debug logs without biometrics |
| `apps/web/src/app/api/log-client-error/route.ts` | Create | Client error ingestion |
| `apps/web/src/app/error.tsx` | Modify | Client error reporting |
| `apps/web/src/app/api/liveness/frame/route.ts` | Modify | Replace console error |
| `apps/web/src/app/api/ocr/route.ts` | Modify | Propagate requestId to OCR |
| `apps/web/src/app/api/ocr/health/route.ts` | Modify | Propagate requestId to OCR |
| `apps/web/src/lib/document/ocr-client.ts` | Modify | Add requestId header |
| `apps/web/src/lib/crypto/fhe-client.ts` | Modify | Add requestId header |
| `apps/ocr/src/ocr_service/core/logging.py` | Create | Request ID logging filter |
| `apps/ocr/src/ocr_service/main.py` | Modify | Request ID middleware |
| `apps/ocr/src/ocr_service/core/auth.py` | Modify | Mask IP in auth warnings |
| `apps/fhe/src/main.rs` | Modify | Request ID in trace spans |

## Tests Added

- `apps/web/src/lib/logging/__tests__/redact.test.ts`
- `apps/web/src/lib/logging/__tests__/error-logger.test.ts`
- `apps/web/src/lib/crypto/__tests__/fhe-client-logging.test.ts`
- `apps/web/src/lib/document/__tests__/ocr-client-logging.test.ts`
- `apps/web/src/app/api/log-client-error/__tests__/route.test.ts`

## Security/Privacy Considerations

1. **No PII in Logs**: Redaction at source + message sanitization prevents accidental exposure
2. **No External Services**: Logs stay on Railway/Docker - no third-party data sharing
3. **Request IDs are Random**: UUIDs can't be linked to users; user identifiers are not logged
4. **No Session Data**: Cookies and auth tokens redacted
5. **Image Data Blocked**: Base64 images detected and replaced
6. **Client Errors Sanitized**: Client error endpoint omits message/stack in production
7. **Service Auth Logs Mask IP**: OCR auth logs obfuscate client IPs

## Technical Notes

- **Performance**: Pino is 10x faster than Winston - minimal overhead
- **Railway Integration**: JSON logs are automatically indexed by Railway
- **Request Correlation**: `X-Request-Id` propagates through web → OCR/FHE; OCR/FHE logs include the same ID
- **Client Errors**: Logged via `/api/log-client-error` (sanitized; no stack/message in prod)
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

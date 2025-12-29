# RFC-0004: Redis Caching and Rate Limiting

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Replace in-memory rate limiters with Redis-backed persistence using DragonflyDB (self-hosted), add a caching layer for frequently accessed data, and enable horizontal scaling.

## Problem Statement

The current implementation has several limitations:

1. **Rate Limiters Reset on Deploy**: Three separate in-memory `Map` instances:

   ```typescript
   // identity.ts - Document OCR
   const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
   // 10 requests per 60 seconds per IP

   // attestation.ts - Blockchain attestation
   const attemptTracker = new Map<string, { count: number; resetAt: number }>();
   // 3 attempts per hour per userId:networkId

   // token.ts - Token minting
   const mintAttemptTracker = new Map<string, { count: number; resetAt: number }>();
   // 3 mints per hour per userId:networkId
   ```

   All reset when the server restarts or redeploys.

2. **No Horizontal Scaling**: Each server instance has its own rate limit state. With N instances, effective rate limit is N × configured limit.

3. **No Shared Cache**: FHE public keys, session metadata, and frequently accessed data are queried from SQLite on every request.

4. **Duplicate In-Memory Rate Limit Logic**: Three nearly identical implementations with minor variations.

## Design Decisions

- **Redis Alternative**: DragonflyDB over Redis/Valkey
  - Drop-in Redis replacement (uses Redis protocol)
  - 25x faster than Redis with lower memory usage
  - Self-hosted on Railway or Docker
  - Single binary, easy deployment
  - No external data sharing (privacy-first)

- **Rate Limit Library**: `@upstash/ratelimit` with custom Redis connection
  - Works with any Redis-compatible store (not just Upstash)
  - Sliding window algorithm (fairer than fixed window)
  - TypeScript-first with good types
  - Supports multiple limit configurations

- **Cache Strategy**: Read-through with TTL
  - Cache FHE public keys (frequent lookups, rarely change)
  - Cache verification status (expensive query)
  - Short TTL to avoid stale data
  - Hash-based cache keys for privacy

## Architecture Overview

### New Structure

```text
src/lib/cache/
├── redis.ts                # ioredis client for DragonflyDB
├── keys.ts                 # Cache key generation (privacy-safe)
├── fhe-keys.ts             # FHE public key caching
├── verification.ts         # Verification status caching
└── index.ts                # Public API

src/lib/rate-limit/
├── limiter.ts              # Unified rate limiter factory
├── middleware.ts           # tRPC rate limit middleware
├── configs.ts              # Rate limit configurations
└── index.ts                # Public API
```

### Redis Connection

```typescript
// src/lib/cache/redis.ts
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Singleton connection
let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Connection pooling handled by ioredis
    });

    redis.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }
  return redis;
}

// For graceful shutdown
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
```

### Privacy-Safe Cache Keys

```typescript
// src/lib/cache/keys.ts
import { createHash } from "crypto";

// Never use user IDs directly in cache keys
// Hash them to prevent enumeration attacks
function hashKey(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export const cacheKeys = {
  // FHE public key by user
  fhePublicKey: (userId: string) => `fhe:pub:${hashKey(userId)}`,

  // Verification status by user
  verificationStatus: (userId: string) => `verify:status:${hashKey(userId)}`,

  // Rate limit by IP (for anonymous endpoints)
  rateLimitIp: (ip: string) => `rl:ip:${hashKey(ip)}`,

  // Rate limit by user+action
  rateLimitUser: (userId: string, action: string) =>
    `rl:user:${hashKey(userId)}:${action}`,
};
```

### Unified Rate Limiter

```typescript
// src/lib/rate-limit/limiter.ts
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "../cache/redis";

// Custom Redis adapter for @upstash/ratelimit
class IoRedisAdapter {
  private redis = getRedis();

  async eval<T>(
    script: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<T> {
    return this.redis.eval(script, keys.length, ...keys, ...args) as Promise<T>;
  }
}

// Rate limit configurations
export const rateLimits = {
  // Document OCR: 10 requests per minute per IP
  documentOcr: new Ratelimit({
    redis: new IoRedisAdapter(),
    limiter: Ratelimit.slidingWindow(10, "60s"),
    prefix: "rl:doc:",
    analytics: false, // No analytics to external service
  }),

  // Attestation: 3 attempts per hour per user+network
  attestation: new Ratelimit({
    redis: new IoRedisAdapter(),
    limiter: Ratelimit.slidingWindow(3, "1h"),
    prefix: "rl:attest:",
    analytics: false,
  }),

  // Token mint: 3 requests per hour per user+network
  tokenMint: new Ratelimit({
    redis: new IoRedisAdapter(),
    limiter: Ratelimit.slidingWindow(3, "1h"),
    prefix: "rl:mint:",
    analytics: false,
  }),

  // General API: 100 requests per minute per user
  api: new Ratelimit({
    redis: new IoRedisAdapter(),
    limiter: Ratelimit.slidingWindow(100, "60s"),
    prefix: "rl:api:",
    analytics: false,
  }),
};

// Check rate limit and return result
export async function checkRateLimit(
  limiter: keyof typeof rateLimits,
  identifier: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const rl = rateLimits[limiter];
  const result = await rl.limit(identifier);

  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}
```

### Rate Limit Middleware

```typescript
// src/lib/rate-limit/middleware.ts
import { TRPCError } from "@trpc/server";
import { middleware } from "@trpc/server";
import { checkRateLimit, rateLimits } from "./limiter";
import { cacheKeys } from "../cache/keys";

type RateLimitType = keyof typeof rateLimits;

export function createRateLimitMiddleware(limiterType: RateLimitType) {
  return middleware(async ({ ctx, next }) => {
    // Get identifier based on limiter type
    let identifier: string;

    if (limiterType === "documentOcr") {
      // Use IP for anonymous endpoints
      const forwarded = ctx.req.headers.get("x-forwarded-for");
      identifier = forwarded ? forwarded.split(",")[0].trim() : "unknown";
    } else {
      // Use userId for authenticated endpoints
      if (!ctx.userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      identifier = ctx.userId;
    }

    const result = await checkRateLimit(limiterType, identifier);

    if (!result.success) {
      const resetDate = new Date(result.reset);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. Try again at ${resetDate.toISOString()}`,
      });
    }

    // Add rate limit info to context for response headers
    return next({
      ctx: {
        ...ctx,
        rateLimit: {
          remaining: result.remaining,
          reset: result.reset,
        },
      },
    });
  });
}

// Pre-built middlewares
export const documentOcrRateLimit = createRateLimitMiddleware("documentOcr");
export const attestationRateLimit = createRateLimitMiddleware("attestation");
export const tokenMintRateLimit = createRateLimitMiddleware("tokenMint");
export const apiRateLimit = createRateLimitMiddleware("api");
```

### FHE Key Caching

```typescript
// src/lib/cache/fhe-keys.ts
import { getRedis } from "./redis";
import { cacheKeys } from "./keys";
import { getFhePublicKeyByUserId } from "@/lib/db/queries/crypto";

const FHE_KEY_TTL_SECONDS = 60 * 5; // 5 minutes

export async function getCachedFhePublicKey(
  userId: string
): Promise<string | null> {
  const redis = getRedis();
  const key = cacheKeys.fhePublicKey(userId);

  // Try cache first
  const cached = await redis.get(key);
  if (cached) {
    return cached;
  }

  // Cache miss - fetch from DB
  const publicKey = await getFhePublicKeyByUserId(userId);
  if (publicKey) {
    // Cache for next time
    await redis.setex(key, FHE_KEY_TTL_SECONDS, publicKey);
  }

  return publicKey;
}

export async function invalidateFhePublicKey(userId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(cacheKeys.fhePublicKey(userId));
}
```

### Verification Status Caching

```typescript
// src/lib/cache/verification.ts
import { getRedis } from "./redis";
import { cacheKeys } from "./keys";
import { getVerificationStatus } from "@/lib/db/queries/identity";

const VERIFICATION_TTL_SECONDS = 30; // Short TTL - status can change

export async function getCachedVerificationStatus(userId: string) {
  const redis = getRedis();
  const key = cacheKeys.verificationStatus(userId);

  // Try cache first
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // Cache miss - fetch from DB
  const status = getVerificationStatus(userId);

  // Cache for next time
  await redis.setex(key, VERIFICATION_TTL_SECONDS, JSON.stringify(status));

  return status;
}

export async function invalidateVerificationStatus(userId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(cacheKeys.verificationStatus(userId));
}
```

### Docker Compose Addition

```yaml
# docker-compose.yml
services:
  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
    container_name: zentity-dragonfly
    ports:
      - "6379:6379"
    volumes:
      - dragonfly_data:/data
    command: ["--logtostderr"]
    networks:
      - zentity-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  dragonfly_data:
```

### Usage in Routers

```typescript
// Before (identity.ts)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
// ... 30 lines of rate limit logic

if (isRateLimited(ip)) {
  throw new TRPCError({ code: "TOO_MANY_REQUESTS", ... });
}

// After (identity.ts)
import { documentOcrRateLimit } from "@/lib/rate-limit";

export const identityRouter = router({
  processDocument: publicProcedure
    .use(documentOcrRateLimit) // Single line!
    .input(processDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      // Rate limiting handled by middleware
      // ...
    }),
});
```

## Implementation Steps

### Step 1: Add Dependencies

```bash
cd apps/web
bun add ioredis @upstash/ratelimit
```

### Step 2: Add DragonflyDB to Docker Compose

Update `docker-compose.yml` with the DragonflyDB service.

### Step 3: Create Redis Connection Module

Create `src/lib/cache/redis.ts` with connection pooling.

### Step 4: Create Cache Key Utilities

Create `src/lib/cache/keys.ts` with privacy-safe hashing.

### Step 5: Create Unified Rate Limiter

Create `src/lib/rate-limit/limiter.ts` with all configurations.

### Step 6: Create Rate Limit Middleware

Create `src/lib/rate-limit/middleware.ts` for tRPC integration.

### Step 7: Add Caching Utilities

Create FHE key and verification status caching modules.

### Step 8: Update Routers

Replace in-memory rate limiters with middleware:

| Router | Current | New |
|--------|---------|-----|
| `identity.ts` | `rateLimitMap` + `isRateLimited()` | `documentOcrRateLimit` middleware |
| `attestation.ts` | `attemptTracker` + `checkRateLimit()` | `attestationRateLimit` middleware |
| `token.ts` | `mintAttemptTracker` + `checkMintRateLimit()` | `tokenMintRateLimit` middleware |

### Step 9: Add Cache Invalidation

Update data mutation functions to invalidate caches:

```typescript
// After updating FHE key
await invalidateFhePublicKey(userId);

// After verification status changes
await invalidateVerificationStatus(userId);
```

### Step 10: Add Environment Variable

```bash
# .env.example
REDIS_URL=redis://localhost:6379
```

### Step 11: Update Railway Config

Add DragonflyDB service to Railway project or use Railway's Redis add-on.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/cache/redis.ts` | Create | Redis connection |
| `src/lib/cache/keys.ts` | Create | Cache key generation |
| `src/lib/cache/fhe-keys.ts` | Create | FHE key caching |
| `src/lib/cache/verification.ts` | Create | Status caching |
| `src/lib/cache/index.ts` | Create | Public API |
| `src/lib/rate-limit/limiter.ts` | Create | Rate limiter factory |
| `src/lib/rate-limit/middleware.ts` | Create | tRPC middleware |
| `src/lib/rate-limit/configs.ts` | Create | Limit configurations |
| `src/lib/rate-limit/index.ts` | Create | Public API |
| `docker-compose.yml` | Modify | Add DragonflyDB |
| `src/lib/trpc/routers/identity.ts` | Modify | Use middleware |
| `src/lib/trpc/routers/attestation.ts` | Modify | Use middleware |
| `src/lib/trpc/routers/token.ts` | Modify | Use middleware |
| `.env.example` | Modify | Add REDIS_URL |

## Security/Privacy Considerations

1. **Hashed Cache Keys**: User IDs are SHA-256 hashed in cache keys to prevent enumeration
2. **Self-Hosted Only**: DragonflyDB runs on your infrastructure - no external data sharing
3. **No Analytics**: `@upstash/ratelimit` analytics disabled to prevent data leakage
4. **Short TTLs**: Verification status cached for only 30 seconds to minimize stale data
5. **Connection Encryption**: Use TLS for Redis connections in production

## Technical Notes

- **Fallback Behavior**: If Redis is unavailable, consider falling back to in-memory (with warning logs)
- **Connection Pooling**: ioredis handles connection pooling automatically
- **Cluster Support**: DragonflyDB supports Redis cluster protocol if scaling needed
- **Memory Limits**: Configure DragonflyDB `--maxmemory` to prevent OOM
- **Persistence**: DragonflyDB supports RDB/AOF persistence if needed

## Package Changes

```json
{
  "dependencies": {
    "ioredis": "^5.x",
    "@upstash/ratelimit": "^2.x"
  }
}
```

## References

- [DragonflyDB Documentation](https://www.dragonflydb.io/docs)
- [ioredis Documentation](https://github.com/redis/ioredis)
- [@upstash/ratelimit](https://github.com/upstash/ratelimit)
- [Sliding Window Rate Limiting](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)

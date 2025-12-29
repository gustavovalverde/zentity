# RFC-0005: Background Jobs with BullMQ

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Add a server-side background job queue using BullMQ for async operations, scheduled cleanup tasks, and retry-capable workflows, running on the same DragonflyDB instance from RFC-0004.

## Problem Statement

Currently, all operations are synchronous within request handlers:

1. **No Retry Logic**: Failed operations (email sending, webhook delivery) simply fail with no automatic retry.

2. **Blocking Operations**: Long-running tasks block the request/response cycle:

   ```typescript
   // Current: User waits for email to send
   await sendVerificationEmail(user.email);
   return { success: true };
   ```

3. **No Scheduled Tasks**: Cleanup of expired data requires manual intervention:
   - Expired onboarding sessions (30-minute TTL)
   - Used RP authorization codes
   - Old ZK challenge nonces

4. **No Batch Processing**: Operations that could benefit from batching are done inline:
   - Attestation evidence aggregation
   - Webhook delivery to multiple endpoints

5. **Resource Contention**: Heavy operations compete with user-facing requests for server resources.

## Design Decisions

- **Queue System**: BullMQ over alternatives
  - Production-tested at scale (Shopify, Microsoft, etc.)
  - Redis-backed (uses DragonflyDB from RFC-0004)
  - TypeScript-first with excellent types
  - Built-in retry with exponential backoff
  - Supports scheduled/delayed jobs
  - Separate worker processes for isolation

- **Worker Architecture**: Separate worker process
  - Runs alongside Next.js server
  - Isolated resource usage
  - Can be scaled independently
  - Graceful shutdown support

- **Job Categories**:
  - **Immediate**: Process as soon as possible (email, webhook)
  - **Scheduled**: Run at specific times (cleanup)
  - **Delayed**: Run after a delay (retry after failure)

## Architecture Overview

### New Structure

```text
src/lib/jobs/
├── queue.ts                # Queue configuration
├── connection.ts           # Redis connection for BullMQ
├── types.ts                # Job payload types
├── workers/
│   ├── cleanup.ts          # Session/nonce cleanup worker
│   ├── email.ts            # Email sending worker
│   ├── webhook.ts          # Webhook delivery worker
│   └── index.ts            # Worker registry
├── jobs/
│   ├── cleanup.ts          # Cleanup job definitions
│   ├── email.ts            # Email job definitions
│   ├── webhook.ts          # Webhook job definitions
│   └── index.ts
└── index.ts                # Public API
```

### Queue Configuration

```typescript
// src/lib/jobs/queue.ts
import { Queue, Worker, QueueEvents } from "bullmq";
import { getRedisConnection } from "./connection";

// Queue names
export const QUEUE_NAMES = {
  email: "email",
  cleanup: "cleanup",
  webhook: "webhook",
} as const;

// Create queues
export const queues = {
  email: new Queue(QUEUE_NAMES.email, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000, // 1s, 2s, 4s
      },
      removeOnComplete: 100, // Keep last 100 completed
      removeOnFail: 1000, // Keep last 1000 failed for debugging
    },
  }),

  cleanup: new Queue(QUEUE_NAMES.cleanup, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 1, // Cleanup jobs don't retry
      removeOnComplete: true,
      removeOnFail: 100,
    },
  }),

  webhook: new Queue(QUEUE_NAMES.webhook, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5000, // 5s, 10s, 20s, 40s, 80s
      },
      removeOnComplete: 100,
      removeOnFail: 1000,
    },
  }),
};
```

### Job Type Definitions

```typescript
// src/lib/jobs/types.ts

// Email jobs
export interface SendVerificationEmailJob {
  type: "verification";
  userId: string;
  email: string;
  token: string;
}

export interface SendWelcomeEmailJob {
  type: "welcome";
  userId: string;
  email: string;
  name: string;
}

export type EmailJob = SendVerificationEmailJob | SendWelcomeEmailJob;

// Cleanup jobs
export interface CleanupExpiredSessionsJob {
  type: "expired-sessions";
  olderThanMinutes: number;
}

export interface CleanupUsedNoncesJob {
  type: "used-nonces";
  olderThanHours: number;
}

export interface CleanupUsedAuthCodesJob {
  type: "used-auth-codes";
  olderThanHours: number;
}

export type CleanupJob =
  | CleanupExpiredSessionsJob
  | CleanupUsedNoncesJob
  | CleanupUsedAuthCodesJob;

// Webhook jobs
export interface WebhookDeliveryJob {
  url: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  secret?: string; // For HMAC signing
}
```

### Email Worker

```typescript
// src/lib/jobs/workers/email.ts
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES } from "../queue";
import type { EmailJob } from "../types";
import { logger } from "@/lib/logging";

export function createEmailWorker(): Worker<EmailJob> {
  return new Worker<EmailJob>(
    QUEUE_NAMES.email,
    async (job: Job<EmailJob>) => {
      const log = logger.child({ jobId: job.id, jobType: job.data.type });
      log.info("Processing email job");

      switch (job.data.type) {
        case "verification":
          await sendVerificationEmail(job.data);
          break;
        case "welcome":
          await sendWelcomeEmail(job.data);
          break;
        default:
          throw new Error(`Unknown email job type: ${(job.data as any).type}`);
      }

      log.info("Email job completed");
    },
    {
      connection: getRedisConnection(),
      concurrency: 5, // Process 5 emails at a time
      limiter: {
        max: 10,
        duration: 1000, // Max 10 emails per second (rate limit)
      },
    }
  );
}

async function sendVerificationEmail(data: SendVerificationEmailJob) {
  // TODO: Implement with actual email provider
  // For now, just log
  logger.info({ email: data.email }, "Would send verification email");
}

async function sendWelcomeEmail(data: SendWelcomeEmailJob) {
  logger.info({ email: data.email, name: data.name }, "Would send welcome email");
}
```

### Cleanup Worker

```typescript
// src/lib/jobs/workers/cleanup.ts
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES } from "../queue";
import type { CleanupJob } from "../types";
import { db } from "@/lib/db";
import { logger } from "@/lib/logging";

export function createCleanupWorker(): Worker<CleanupJob> {
  return new Worker<CleanupJob>(
    QUEUE_NAMES.cleanup,
    async (job: Job<CleanupJob>) => {
      const log = logger.child({ jobId: job.id, jobType: job.data.type });
      log.info("Processing cleanup job");

      let deleted = 0;

      switch (job.data.type) {
        case "expired-sessions":
          deleted = await cleanupExpiredSessions(job.data.olderThanMinutes);
          break;
        case "used-nonces":
          deleted = await cleanupUsedNonces(job.data.olderThanHours);
          break;
        case "used-auth-codes":
          deleted = await cleanupUsedAuthCodes(job.data.olderThanHours);
          break;
      }

      log.info({ deleted }, "Cleanup job completed");
      return { deleted };
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // One cleanup at a time
    }
  );
}

async function cleanupExpiredSessions(olderThanMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();

  const result = db.run(`
    DELETE FROM onboarding_sessions
    WHERE created_at < ? OR expires_at < datetime('now')
  `, [cutoff]);

  return result.changes;
}

async function cleanupUsedNonces(olderThanHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const result = db.run(`
    DELETE FROM zk_challenges
    WHERE consumed_at IS NOT NULL AND consumed_at < ?
  `, [cutoff]);

  return result.changes;
}

async function cleanupUsedAuthCodes(olderThanHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const result = db.run(`
    DELETE FROM rp_authorization_codes
    WHERE used_at IS NOT NULL AND used_at < ?
  `, [cutoff]);

  return result.changes;
}
```

### Webhook Worker

```typescript
// src/lib/jobs/workers/webhook.ts
import { Worker, Job } from "bullmq";
import { createHmac } from "crypto";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES } from "../queue";
import type { WebhookDeliveryJob } from "../types";
import { logger } from "@/lib/logging";

export function createWebhookWorker(): Worker<WebhookDeliveryJob> {
  return new Worker<WebhookDeliveryJob>(
    QUEUE_NAMES.webhook,
    async (job: Job<WebhookDeliveryJob>) => {
      const log = logger.child({ jobId: job.id, url: job.data.url });
      log.info("Delivering webhook");

      const body = JSON.stringify(job.data.payload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...job.data.headers,
      };

      // Add HMAC signature if secret provided
      if (job.data.secret) {
        const signature = createHmac("sha256", job.data.secret)
          .update(body)
          .digest("hex");
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      const response = await fetch(job.data.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Webhook failed: ${response.status} - ${text}`);
      }

      log.info({ status: response.status }, "Webhook delivered");
    },
    {
      connection: getRedisConnection(),
      concurrency: 10, // 10 concurrent webhooks
      limiter: {
        max: 50,
        duration: 1000, // Max 50 webhooks per second
      },
    }
  );
}
```

### Job Scheduling

```typescript
// src/lib/jobs/jobs/cleanup.ts
import { queues } from "../queue";

// Schedule recurring cleanup jobs
export async function scheduleCleanupJobs(): Promise<void> {
  // Run every hour
  await queues.cleanup.add(
    "expired-sessions",
    { type: "expired-sessions", olderThanMinutes: 30 },
    {
      repeat: { every: 60 * 60 * 1000 }, // Every hour
      jobId: "cleanup-expired-sessions", // Prevent duplicates
    }
  );

  await queues.cleanup.add(
    "used-nonces",
    { type: "used-nonces", olderThanHours: 24 },
    {
      repeat: { every: 60 * 60 * 1000 },
      jobId: "cleanup-used-nonces",
    }
  );

  await queues.cleanup.add(
    "used-auth-codes",
    { type: "used-auth-codes", olderThanHours: 1 },
    {
      repeat: { every: 60 * 60 * 1000 },
      jobId: "cleanup-used-auth-codes",
    }
  );
}

// Cancel all scheduled cleanup jobs
export async function cancelCleanupJobs(): Promise<void> {
  await queues.cleanup.removeRepeatable("expired-sessions", {
    every: 60 * 60 * 1000,
  });
  // ... etc
}
```

### Worker Entry Point

```typescript
// src/lib/jobs/workers/index.ts
import { createEmailWorker } from "./email";
import { createCleanupWorker } from "./cleanup";
import { createWebhookWorker } from "./webhook";
import { scheduleCleanupJobs } from "../jobs/cleanup";
import { logger } from "@/lib/logging";

const workers: Worker[] = [];

export async function startWorkers(): Promise<void> {
  logger.info("Starting background workers");

  workers.push(createEmailWorker());
  workers.push(createCleanupWorker());
  workers.push(createWebhookWorker());

  // Schedule recurring jobs
  await scheduleCleanupJobs();

  logger.info({ count: workers.length }, "Workers started");
}

export async function stopWorkers(): Promise<void> {
  logger.info("Stopping background workers");

  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;

  logger.info("Workers stopped");
}
```

### Integration with Application

```typescript
// src/lib/jobs/index.ts
export { queues } from "./queue";
export { startWorkers, stopWorkers } from "./workers";
export type * from "./types";

// Convenience functions for adding jobs
export async function enqueueEmail(job: EmailJob): Promise<string> {
  const result = await queues.email.add(job.type, job);
  return result.id!;
}

export async function enqueueWebhook(job: WebhookDeliveryJob): Promise<string> {
  const result = await queues.webhook.add("deliver", job);
  return result.id!;
}
```

### Usage in tRPC Routers

```typescript
// Before (blocking)
export const authRouter = router({
  signup: publicProcedure
    .input(signupSchema)
    .mutation(async ({ input }) => {
      const user = await createUser(input);
      await sendVerificationEmail(user.email, token); // Blocks response
      return { success: true };
    }),
});

// After (non-blocking)
import { enqueueEmail } from "@/lib/jobs";

export const authRouter = router({
  signup: publicProcedure
    .input(signupSchema)
    .mutation(async ({ input }) => {
      const user = await createUser(input);

      // Queue email - returns immediately
      await enqueueEmail({
        type: "verification",
        userId: user.id,
        email: user.email,
        token,
      });

      return { success: true };
    }),
});
```

### Worker Process Script

```typescript
// scripts/worker.ts
import { startWorkers, stopWorkers } from "@/lib/jobs";
import { closeRedis } from "@/lib/cache/redis";
import { logger } from "@/lib/logging";

async function main() {
  await startWorkers();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down workers");
    await stopWorkers();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ error: err }, "Worker startup failed");
  process.exit(1);
});
```

### Package.json Scripts

```json
{
  "scripts": {
    "worker": "bun run scripts/worker.ts",
    "worker:dev": "bun --watch run scripts/worker.ts"
  }
}
```

## Implementation Steps

### Step 1: Add Dependencies

```bash
cd apps/web
bun add bullmq
```

### Step 2: Create Job Queue Module

Create `src/lib/jobs/queue.ts` with queue configurations.

### Step 3: Create Job Type Definitions

Create `src/lib/jobs/types.ts` with TypeScript interfaces.

### Step 4: Create Workers

Create workers for email, cleanup, and webhook delivery.

### Step 5: Create Job Scheduling

Create scheduled job definitions for recurring tasks.

### Step 6: Create Worker Entry Point

Create `src/lib/jobs/workers/index.ts` for worker lifecycle.

### Step 7: Create Worker Script

Create `scripts/worker.ts` for standalone worker process.

### Step 8: Update Package.json

Add worker scripts.

### Step 9: Update Docker Compose

Add worker service:

```yaml
services:
  worker:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    command: ["bun", "run", "worker"]
    depends_on:
      - dragonfly
    environment:
      - REDIS_URL=redis://dragonfly:6379
    networks:
      - zentity-network
```

### Step 10: Integrate with Routers

Update tRPC routers to use job queues instead of inline operations.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/jobs/queue.ts` | Create | Queue configuration |
| `src/lib/jobs/connection.ts` | Create | Redis connection |
| `src/lib/jobs/types.ts` | Create | Job type definitions |
| `src/lib/jobs/workers/email.ts` | Create | Email worker |
| `src/lib/jobs/workers/cleanup.ts` | Create | Cleanup worker |
| `src/lib/jobs/workers/webhook.ts` | Create | Webhook worker |
| `src/lib/jobs/workers/index.ts` | Create | Worker lifecycle |
| `src/lib/jobs/jobs/cleanup.ts` | Create | Scheduled jobs |
| `src/lib/jobs/index.ts` | Create | Public API |
| `scripts/worker.ts` | Create | Worker entry point |
| `package.json` | Modify | Add worker scripts |
| `docker-compose.yml` | Modify | Add worker service |

## Security/Privacy Considerations

1. **No PII in Job Payloads**: Store user IDs, not email contents or names
2. **HMAC Webhook Signatures**: Prevent webhook forgery with shared secrets
3. **Job Payload Encryption**: Consider encrypting sensitive job data at rest
4. **Rate Limiting**: Workers have built-in rate limiters to prevent abuse
5. **Retry Limits**: Failed jobs eventually stop retrying (configurable)

## Technical Notes

- **DragonflyDB Compatibility**: BullMQ works with DragonflyDB (Redis-compatible)
- **Worker Scaling**: Run multiple worker instances for horizontal scaling
- **Monitoring**: BullMQ has dashboard (bull-board) for job monitoring
- **Dead Letter Queue**: Failed jobs are kept for debugging (configurable retention)
- **Priority Queues**: BullMQ supports priority if needed later

## Package Changes

```json
{
  "dependencies": {
    "bullmq": "^5.x"
  }
}
```

## References

- [BullMQ Documentation](https://bullmq.io/)
- [BullMQ Best Practices](https://docs.bullmq.io/guide/best-practices)
- [Bull Board Dashboard](https://github.com/felixmosh/bull-board)
- [Job Queue Patterns](https://www.inngest.com/blog/job-queue-patterns)

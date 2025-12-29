# RFC-0007: Feature Flags System

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

## Summary

Replace hardcoded environment variables with a type-safe, config-file-based feature flag system that supports hot-reloading in development and can evolve to self-hosted Unleash for advanced targeting.

## Problem Statement

Current feature flag implementation has limitations:

1. **Environment Variables Only**: Features controlled via `NEXT_PUBLIC_*` env vars:

   ```typescript
   // Current pattern - scattered across codebase
   const enableFhevm = process.env.NEXT_PUBLIC_ENABLE_FHEVM === "true";
   const enableHardhat = process.env.NEXT_PUBLIC_ENABLE_HARDHAT === "true";
   const enableDemo = process.env.NEXT_PUBLIC_ATTESTATION_DEMO === "true";
   ```

2. **No Gradual Rollouts**: Features are either fully on or fully off for all users.

3. **Deploy Required for Changes**: Changing a flag requires redeploying the application.

4. **No Centralized View**: Flags scattered across code, no single source of truth.

5. **No Type Safety**: Typos in env var names fail silently.

6. **Client/Server Split**: `NEXT_PUBLIC_*` prefix controls visibility but is easy to misuse.

## Design Decisions

- **Initial Implementation**: Config file + Zod schema
  - Zero external dependencies
  - Type-safe at compile time
  - Hot-reload in development
  - Single source of truth
  - Privacy-preserving (no external service)

- **Future Evolution**: Self-hosted Unleash
  - When gradual rollouts needed
  - User-segment targeting
  - A/B testing capabilities
  - Still self-hosted (privacy-first)

- **Flag Categories**:
  - `feature.*` - Product features
  - `experiment.*` - A/B tests (future)
  - `ops.*` - Operational controls
  - `debug.*` - Development aids

## Architecture Overview

### New Structure

```text
src/lib/config/
├── feature-flags.ts        # Flag definitions + Zod schema
├── flags.json              # Default flag values
├── loader.ts               # Config loading + hot-reload
└── index.ts                # Public API
```

### Flag Definition Schema

```typescript
// src/lib/config/feature-flags.ts
import { z } from "zod";

// Flag schema with validation
export const featureFlagsSchema = z.object({
  // Product features
  feature: z.object({
    fhevm: z.boolean().describe("Enable FHEVM blockchain integration"),
    hardhat: z.boolean().describe("Use Hardhat local network"),
    attestationDemo: z.boolean().describe("Enable attestation demo mode"),
    rpFlow: z.boolean().describe("Enable Relying Party OAuth flow"),
    nationalityProof: z.boolean().describe("Enable nationality ZK proof"),
    faceMatch: z.boolean().describe("Enable face matching"),
  }),

  // Operational controls
  ops: z.object({
    maintenanceMode: z.boolean().describe("Show maintenance page"),
    registrationOpen: z.boolean().describe("Allow new user registration"),
    rateLimiting: z.boolean().describe("Enable rate limiting"),
  }),

  // Debug/development
  debug: z.object({
    verboseLogging: z.boolean().describe("Enable verbose logs"),
    mockFheService: z.boolean().describe("Mock FHE service responses"),
    mockOcrService: z.boolean().describe("Mock OCR service responses"),
    skipLiveness: z.boolean().describe("Skip liveness in dev"),
  }),
});

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

// Default values
export const defaultFlags: FeatureFlags = {
  feature: {
    fhevm: false,
    hardhat: true,
    attestationDemo: true,
    rpFlow: true,
    nationalityProof: true,
    faceMatch: true,
  },
  ops: {
    maintenanceMode: false,
    registrationOpen: true,
    rateLimiting: true,
  },
  debug: {
    verboseLogging: false,
    mockFheService: false,
    mockOcrService: false,
    skipLiveness: false,
  },
};
```

### Flag Configuration File

```json
// src/lib/config/flags.json
{
  "feature": {
    "fhevm": false,
    "hardhat": true,
    "attestationDemo": true,
    "rpFlow": true,
    "nationalityProof": true,
    "faceMatch": true
  },
  "ops": {
    "maintenanceMode": false,
    "registrationOpen": true,
    "rateLimiting": true
  },
  "debug": {
    "verboseLogging": false,
    "mockFheService": false,
    "mockOcrService": false,
    "skipLiveness": false
  }
}
```

### Config Loader with Hot-Reload

```typescript
// src/lib/config/loader.ts
import { readFileSync, watchFile, unwatchFile } from "fs";
import { join } from "path";
import { featureFlagsSchema, defaultFlags, type FeatureFlags } from "./feature-flags";
import { logger } from "@/lib/logging";

const CONFIG_PATH = join(process.cwd(), "src/lib/config/flags.json");

let currentFlags: FeatureFlags = defaultFlags;
let isWatching = false;

function loadFlags(): FeatureFlags {
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content);
    const validated = featureFlagsSchema.parse(parsed);

    logger.info({ flags: validated }, "Feature flags loaded");
    return validated;
  } catch (error) {
    logger.warn({ error }, "Failed to load flags.json, using defaults");
    return defaultFlags;
  }
}

function startWatching(): void {
  if (isWatching || process.env.NODE_ENV === "production") return;

  watchFile(CONFIG_PATH, { interval: 1000 }, () => {
    logger.info("flags.json changed, reloading");
    currentFlags = loadFlags();
  });

  isWatching = true;
}

function stopWatching(): void {
  if (!isWatching) return;
  unwatchFile(CONFIG_PATH);
  isWatching = false;
}

// Initialize
export function initFlags(): void {
  currentFlags = loadFlags();
  startWatching();
}

// Cleanup
export function cleanupFlags(): void {
  stopWatching();
}

// Get current flags (reactive in dev)
export function getFlags(): FeatureFlags {
  return currentFlags;
}

// Check specific flag
export function isEnabled(path: string): boolean {
  const parts = path.split(".");
  let value: unknown = currentFlags;

  for (const part of parts) {
    if (typeof value !== "object" || value === null) return false;
    value = (value as Record<string, unknown>)[part];
  }

  return value === true;
}
```

### Public API

```typescript
// src/lib/config/index.ts
export { initFlags, cleanupFlags, getFlags, isEnabled } from "./loader";
export { featureFlagsSchema, defaultFlags } from "./feature-flags";
export type { FeatureFlags } from "./feature-flags";

// Convenience functions
import { getFlags } from "./loader";

export const flags = {
  // Feature flags
  get fhevm() { return getFlags().feature.fhevm; },
  get hardhat() { return getFlags().feature.hardhat; },
  get attestationDemo() { return getFlags().feature.attestationDemo; },
  get rpFlow() { return getFlags().feature.rpFlow; },
  get nationalityProof() { return getFlags().feature.nationalityProof; },
  get faceMatch() { return getFlags().feature.faceMatch; },

  // Ops flags
  get maintenanceMode() { return getFlags().ops.maintenanceMode; },
  get registrationOpen() { return getFlags().ops.registrationOpen; },
  get rateLimiting() { return getFlags().ops.rateLimiting; },

  // Debug flags
  get verboseLogging() { return getFlags().debug.verboseLogging; },
  get mockFheService() { return getFlags().debug.mockFheService; },
  get mockOcrService() { return getFlags().debug.mockOcrService; },
  get skipLiveness() { return getFlags().debug.skipLiveness; },
};
```

### Usage in Components

```typescript
// Before
const enableFhevm = process.env.NEXT_PUBLIC_ENABLE_FHEVM === "true";

if (enableFhevm) {
  // ...
}

// After
import { flags } from "@/lib/config";

if (flags.fhevm) {
  // ...
}
```

### Usage in Server Components

```typescript
// src/app/layout.tsx
import { initFlags } from "@/lib/config";

// Initialize on server startup
initFlags();

export default function RootLayout({ children }) {
  return <html>{children}</html>;
}
```

### Usage in tRPC Routers

```typescript
// src/lib/trpc/routers/attestation.ts
import { flags } from "@/lib/config";

export const attestationRouter = router({
  submit: protectedProcedure
    .input(submitSchema)
    .mutation(async ({ ctx, input }) => {
      if (!flags.fhevm) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "FHEVM is not enabled",
        });
      }

      // ...
    }),
});
```

### Maintenance Mode Middleware

```typescript
// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { flags } from "@/lib/config";

export function middleware(request: NextRequest) {
  // Skip API routes and static files
  if (
    request.nextUrl.pathname.startsWith("/api") ||
    request.nextUrl.pathname.startsWith("/_next")
  ) {
    return NextResponse.next();
  }

  // Maintenance mode redirect
  if (flags.maintenanceMode && request.nextUrl.pathname !== "/maintenance") {
    return NextResponse.redirect(new URL("/maintenance", request.url));
  }

  return NextResponse.next();
}
```

### Client-Side Flag Access

```typescript
// src/hooks/use-feature-flags.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureFlags } from "@/lib/config";

export function useFeatureFlags() {
  return useQuery<FeatureFlags>({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      const response = await fetch("/api/config/flags");
      return response.json();
    },
    staleTime: 60 * 1000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });
}

// Usage
function MyComponent() {
  const { data: flags, isLoading } = useFeatureFlags();

  if (isLoading || !flags) return null;

  return flags.feature.fhevm ? <FhevmFeature /> : <FallbackFeature />;
}
```

### API Endpoint for Client Flags

```typescript
// src/app/api/config/flags/route.ts
import { NextResponse } from "next/server";
import { getFlags } from "@/lib/config";

export async function GET() {
  const flags = getFlags();

  // Only expose safe flags to client
  const clientFlags = {
    feature: flags.feature,
    ops: {
      maintenanceMode: flags.ops.maintenanceMode,
      registrationOpen: flags.ops.registrationOpen,
    },
    // Don't expose debug flags to client
  };

  return NextResponse.json(clientFlags);
}
```

### Migration from Environment Variables

```typescript
// Migration helper
function migrateEnvToFlags(): Partial<FeatureFlags> {
  return {
    feature: {
      fhevm: process.env.NEXT_PUBLIC_ENABLE_FHEVM === "true",
      hardhat: process.env.NEXT_PUBLIC_ENABLE_HARDHAT !== "false",
      attestationDemo: process.env.NEXT_PUBLIC_ATTESTATION_DEMO === "true",
      // ... map other env vars
    },
  };
}
```

## Implementation Steps

### Step 1: Create Flag Schema

Create `src/lib/config/feature-flags.ts` with Zod schema.

### Step 2: Create Config File

Create `src/lib/config/flags.json` with default values.

### Step 3: Create Config Loader

Create `src/lib/config/loader.ts` with hot-reload support.

### Step 4: Create Public API

Create `src/lib/config/index.ts` with convenience functions.

### Step 5: Add Client Hook

Create `src/hooks/use-feature-flags.ts` for React components.

### Step 6: Add API Endpoint

Create `/api/config/flags` for client-side access.

### Step 7: Initialize in Layout

Add `initFlags()` call in root layout.

### Step 8: Migrate Existing Code

Replace `process.env.NEXT_PUBLIC_*` with `flags.*`:

| Current | New |
|---------|-----|
| `process.env.NEXT_PUBLIC_ENABLE_FHEVM === "true"` | `flags.fhevm` |
| `process.env.NEXT_PUBLIC_ENABLE_HARDHAT !== "false"` | `flags.hardhat` |
| `process.env.NEXT_PUBLIC_ATTESTATION_DEMO === "true"` | `flags.attestationDemo` |

### Step 9: Add Maintenance Mode

Create `/app/maintenance/page.tsx` and middleware.

### Step 10: Update Documentation

Document available flags and their purposes.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/config/feature-flags.ts` | Create | Schema + types |
| `src/lib/config/flags.json` | Create | Flag values |
| `src/lib/config/loader.ts` | Create | Config loading |
| `src/lib/config/index.ts` | Create | Public API |
| `src/hooks/use-feature-flags.ts` | Create | React hook |
| `src/app/api/config/flags/route.ts` | Create | Client endpoint |
| `src/middleware.ts` | Modify | Maintenance mode |
| `src/app/maintenance/page.tsx` | Create | Maintenance page |
| Components using env vars | Modify | Use flags.* |

## Security/Privacy Considerations

1. **No User Data**: Flags are global, not per-user (no tracking)
2. **Debug Flags Hidden**: Debug flags not exposed to client
3. **Server-Side Validation**: All flag checks in tRPC are server-side
4. **No External Service**: Config file is local, no data sharing
5. **Type Safety**: Zod prevents invalid configurations

## Technical Notes

- **Hot-Reload**: Only in development, production reads once
- **File Watching**: Uses Node.js `fs.watchFile` with 1s interval
- **JSON Format**: Simple, editable, git-friendly
- **No Build Step**: Changes take effect immediately in dev
- **Caching**: Client caches flags for 1 minute

## Future Enhancements (Unleash)

When gradual rollouts are needed:

1. **Self-Host Unleash**: Deploy on Railway
2. **SDK Integration**: Replace loader with Unleash SDK
3. **User Context**: Add userId for targeting
4. **Percentage Rollouts**: 10% → 50% → 100%
5. **A/B Testing**: Track variants with analytics

## Package Changes

No new dependencies for initial implementation.

For future Unleash integration:

```json
{
  "dependencies": {
    "@unleash/proxy-client-react": "^4.x"
  }
}
```

## References

- [Zod Documentation](https://zod.dev/)
- [Feature Flags Best Practices](https://martinfowler.com/articles/feature-toggles.html)
- [Unleash Documentation](https://docs.getunleash.io/)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)

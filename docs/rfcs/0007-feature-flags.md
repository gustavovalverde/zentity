# RFC-0007: Environment & Configuration Management

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Updated** | 2026-01-10 |
| **Author** | Gustavo Valverde |

## Summary

Implement a type-safe, validated environment configuration system using T3 Env that:

1. Validates all environment variables at build time (fail fast)
2. Eliminates redundant variables by hardcoding constants
3. Consolidates service URL resolution with environment detection
4. Separates E2E testing configuration from application config

This supersedes the original "Feature Flags System" proposal. Feature flags can evolve to Unleash when gradual rollouts are needed.

## Problem Statement

Current environment configuration has critical issues:

1. **Variable Explosion**: 130+ environment variables across the monorepo
2. **Redundant Duplication**: Every `FHEVM_*` has a `NEXT_PUBLIC_FHEVM_*` twin
3. **Constants as Variables**: Zama contract addresses, chain IDs never change
4. **No Validation**: Missing values fail silently at runtime, not build time
5. **Scattered Configuration**: `.env`, `.env.example`, `railway.toml`, docker-compose all define different subsets
6. **Newcomer Friction**: Impossible to know which variables are actually required

## Design Decisions

### T3 Env over Custom Solution

The original RFC proposed a custom file watcher with fs.watchFile. T3 Env is superior:

- Build-time validation (fail fast on `bun run build`)
- Works in Edge and serverless environments
- Community-maintained and battle-tested
- Server/client separation enforced by types
- Zod coercion handles string → boolean/number

### Hardcode What Never Changes

Zama fhEVM infrastructure contracts on Sepolia are constants. Hardhat deterministic addresses are constants. These should not be environment variables.

### Environment Detection for Services

Instead of manual URL configuration per deployment, detect docker/railway/local automatically.

### Separate E2E Configuration

25+ testing variables pollute the main configuration. Move to `e2e/.env.test`.

## Architecture

### File Structure

```text
apps/web/
├── src/
│   ├── env.ts                        # T3 Env validation (single source of truth)
│   └── lib/
│       ├── blockchain/
│       │   └── constants.ts          # Hardcoded network constants
│       └── config/
│           └── services.ts           # Service URL resolution
├── .env.example                      # Minimal template (~15 vars)
├── .env.local                        # Local overrides (gitignored)
└── e2e/
    └── .env.test                     # E2E-specific vars (25+ vars)
```

### Environment Variables Schema

```typescript
// src/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // ========== REQUIRED ==========
    BETTER_AUTH_SECRET: z.string().min(32, "Must be at least 32 characters"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // ========== DATABASE ==========
    TURSO_DATABASE_URL: z.string().refine(
      (url) => url.startsWith("file:") || url.startsWith("libsql://") || url.startsWith("http"),
      "Must be file:, libsql://, or http(s):// URL"
    ),
    TURSO_AUTH_TOKEN: z.string().optional(),

    // ========== SERVICE URLS ==========
    FHE_SERVICE_URL: z.string().url().default("http://localhost:5001"),
    OCR_SERVICE_URL: z.string().url().default("http://localhost:5004"),
    SIGNER_COORDINATOR_URL: z.string().url().optional(),
    SIGNER_ENDPOINTS: z
      .string()
      .transform((s) => s.split(",").map((url) => url.trim()))
      .optional(),

    // ========== INTERNAL AUTH ==========
    INTERNAL_SERVICE_TOKEN: z.string().optional(),
    INTERNAL_SERVICE_TOKEN_REQUIRED: z.coerce.boolean().optional(),

    // ========== YOUR DEPLOYED CONTRACTS ==========
    FHEVM_IDENTITY_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    FHEVM_COMPLIANCE_RULES: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    FHEVM_COMPLIANT_ERC20: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

    // ========== WALLET KEYS ==========
    REGISTRAR_PRIVATE_KEY: z.string().optional(),
    FHEVM_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    LOCAL_REGISTRAR_PRIVATE_KEY: z.string().optional(),

    // ========== OAUTH ==========
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // ========== EMAIL ==========
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM_EMAIL: z.string().email().default("no-reply@zentity.local"),
    MAIL_FROM_NAME: z.string().default("Zentity"),
    MAILPIT_BASE_URL: z.string().url().optional(),
    MAILPIT_SEND_API_URL: z.string().url().optional(),
    MAILPIT_SEND_API_USERNAME: z.string().optional(),
    MAILPIT_SEND_API_PASSWORD: z.string().optional(),

    // ========== RECOVERY ==========
    RECOVERY_RSA_PRIVATE_KEY: z.string().optional(),
    RECOVERY_RSA_PRIVATE_KEY_PATH: z.string().default(".data/recovery-key.pem"),
    RECOVERY_KEY_ID: z.string().default("v1"),

    // ========== OBSERVABILITY ==========
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
    OTEL_ENABLED: z.coerce.boolean().default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),

    // ========== PATHS ==========
    SECRET_BLOB_DIR: z.string().default(".data/secret-blobs"),
    BB_CRS_PATH: z.string().default("/tmp/.bb-crs"),
  },

  client: {
    // ========== APP CONFIG ==========
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

    // ========== FEATURE TOGGLES ==========
    NEXT_PUBLIC_ENABLE_FHEVM: z.coerce.boolean().default(false),
    NEXT_PUBLIC_ENABLE_HARDHAT: z.coerce.boolean().default(true),
    NEXT_PUBLIC_ATTESTATION_DEMO: z.coerce.boolean().default(true),

    // ========== WALLET CONFIG ==========
    NEXT_PUBLIC_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED: z.coerce.boolean().default(true),
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT: z.coerce.boolean().default(false),
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963: z.coerce.boolean().default(true),

    // ========== DEBUG ==========
    NEXT_PUBLIC_DEBUG: z.coerce.boolean().default(false),
  },

  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ENABLE_FHEVM: process.env.NEXT_PUBLIC_ENABLE_FHEVM,
    NEXT_PUBLIC_ENABLE_HARDHAT: process.env.NEXT_PUBLIC_ENABLE_HARDHAT,
    NEXT_PUBLIC_ATTESTATION_DEMO: process.env.NEXT_PUBLIC_ATTESTATION_DEMO,
    NEXT_PUBLIC_PROJECT_ID: process.env.NEXT_PUBLIC_PROJECT_ID,
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED: process.env.NEXT_PUBLIC_APPKIT_ENABLE_INJECTED,
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT: process.env.NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT,
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963: process.env.NEXT_PUBLIC_APPKIT_ENABLE_EIP6963,
    NEXT_PUBLIC_DEBUG: process.env.NEXT_PUBLIC_DEBUG,
  },

  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
```

### Hardcoded Constants

```typescript
// src/lib/blockchain/constants.ts

// Zama fhEVM Infrastructure (Sepolia testnet) - these NEVER change
export const ZAMA_CONTRACTS = {
  ACL: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
  KMS: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
  INPUT_VERIFIER: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0",
  DECRYPTION: "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478",
  INPUT_VERIFICATION: "0x483b9dE06E4E4C7D35CCf5837A1668487406D955",
  RELAYER_URL: "https://relayer.testnet.zama.org",
  SDK_PATH: "/fhevm/relayer-sdk-js.umd.js",
  GATEWAY_CHAIN_ID: 10901,
} as const;

export const SEPOLIA_NETWORK = {
  chainId: 11155111,
  networkId: "fhevm_sepolia",
  name: "fhEVM (Sepolia)",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  explorerUrl: "https://sepolia.etherscan.io",
  providerId: "zama",
} as const;

export const HARDHAT_NETWORK = {
  chainId: 31337,
  networkId: "local",
  name: "Hardhat Local",
  rpcUrl: "http://127.0.0.1:8545",
  explorerUrl: "",
  // Deterministic addresses from Hardhat's first deployments
  contracts: {
    identityRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    complianceRules: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    compliantErc20: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
} as const;
```

### Service URL Resolution

```typescript
// src/lib/config/services.ts
import { env } from "@/env";

type Environment = "docker" | "railway" | "local";

function detectEnvironment(): Environment {
  if (process.env.RAILWAY_ENVIRONMENT) return "railway";
  if (process.env.DOCKER_CONTAINER) return "docker";
  return "local";
}

const SERVICE_URLS: Record<Environment, { fhe: string; ocr: string; signer?: string }> = {
  local: {
    fhe: "http://localhost:5001",
    ocr: "http://localhost:5004",
    signer: "http://localhost:5002",
  },
  docker: {
    fhe: "http://fhe:5001",
    ocr: "http://ocr:5004",
    signer: "http://coordinator:5002",
  },
  railway: {
    fhe: "http://fhe.railway.internal:5001",
    ocr: "http://ocr.railway.internal:5004",
    signer: "http://signer.railway.internal:5002",
  },
};

export function getServiceUrls() {
  const detected = detectEnvironment();
  const defaults = SERVICE_URLS[detected];

  return {
    fhe: env.FHE_SERVICE_URL ?? defaults.fhe,
    ocr: env.OCR_SERVICE_URL ?? defaults.ocr,
    signer: env.SIGNER_COORDINATOR_URL ?? defaults.signer,
  };
}
```

## Variables Eliminated

### By Hardcoding (45 variables)

All `FHEVM_*` and `NEXT_PUBLIC_FHEVM_*` pairs for:

- Chain ID, Network ID, Network Name
- Explorer URL, RPC URL, Provider ID
- ACL, KMS, Input Verifier, Decryption, Input Verification addresses
- Relayer URL, SDK URL, Gateway Chain ID

All `LOCAL_*` Hardhat addresses.

### By Consolidation (15 variables)

Service URL pairs merged into environment detection.

### By Separation (25 variables)

E2E testing variables moved to `e2e/.env.test`.

## Minimal .env.example

```bash
# Zentity Web Environment Variables
# Copy to .env.local and fill in required values

# ============================================================
# REQUIRED - App will not start without these
# ============================================================

# Authentication secret (generate with: openssl rand -base64 32)
BETTER_AUTH_SECRET=

# Database URL (SQLite file for local dev)
TURSO_DATABASE_URL=file:./.data/dev.db

# ============================================================
# OPTIONAL - Service Discovery
# ============================================================

# Service URLs (defaults work for local dev with docker-compose)
# FHE_SERVICE_URL=http://localhost:5001
# OCR_SERVICE_URL=http://localhost:5004

# Internal service authentication (required in production)
# INTERNAL_SERVICE_TOKEN=

# ============================================================
# OPTIONAL - Your Deployed Contracts
# ============================================================

# Your deployed contract addresses on Sepolia
# (Zama infrastructure contracts are hardcoded)
# FHEVM_IDENTITY_REGISTRY=0x...
# FHEVM_COMPLIANCE_RULES=0x...
# FHEVM_COMPLIANT_ERC20=0x...

# Registrar wallet keys
# FHEVM_REGISTRAR_PRIVATE_KEY=
# LOCAL_REGISTRAR_PRIVATE_KEY=

# ============================================================
# OPTIONAL - Feature Toggles
# ============================================================

# NEXT_PUBLIC_ENABLE_FHEVM=false
# NEXT_PUBLIC_ENABLE_HARDHAT=true
# NEXT_PUBLIC_ATTESTATION_DEMO=true

# ============================================================
# OPTIONAL - Third-Party Integrations
# ============================================================

# WalletConnect Project ID
# NEXT_PUBLIC_PROJECT_ID=

# OAuth Providers
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=

# Email (Resend)
# RESEND_API_KEY=

# ============================================================
# PRODUCTION ONLY
# ============================================================

# TURSO_AUTH_TOKEN=
# NEXT_PUBLIC_APP_URL=https://app.zentity.xyz
```

## Implementation Steps

1. Install T3 Env: `bun add @t3-oss/env-nextjs`
2. Create `src/env.ts` with Zod schemas
3. Create `src/lib/blockchain/constants.ts` with hardcoded values
4. Create `src/lib/config/services.ts` with environment detection
5. Import `./src/env` in `next.config.ts` for build-time validation
6. Replace all `process.env.*` with `env.*` across codebase
7. Create `e2e/.env.test` and update `playwright.config.ts`
8. Simplify `.env.example`, `docker-compose.yml`, `Dockerfile`
9. Update CLAUDE.md with new configuration guide

## Files to Create

| File | Purpose |
|------|---------|
| `src/env.ts` | T3 Env validation schema |
| `src/lib/blockchain/constants.ts` | Hardcoded network constants |
| `src/lib/config/services.ts` | Service URL resolution |
| `e2e/.env.test` | E2E-specific configuration |

## Files to Modify

| File | Change |
|------|--------|
| `next.config.ts` | Import env validation |
| `.env.example` | Simplify to ~15 vars |
| `docker-compose.yml` | Remove redundant env vars |
| `apps/web/Dockerfile` | Remove hardcoded ARGs |
| `playwright.config.ts` | Load e2e/.env.test |
| `src/lib/blockchain/config/networks.ts` | Use constants.ts |
| `src/lib/utils/service-urls.ts` | Use services.ts |
| `src/lib/wagmi/config.ts` | Use constants.ts |
| `src/hooks/fhevm/use-fhevm-sdk.ts` | Use constants.ts |
| `src/app/api/fhevm/diagnostics/route.ts` | Use constants.ts |
| `src/lib/auth/auth.ts` | Use env.ts |
| `src/lib/crypto/fhe-client.ts` | Use env.ts |
| `src/lib/logging/logger.ts` | Use env.ts |
| `drizzle.config.ts` | Use env.ts |

## Future Evolution: Feature Flags

When gradual rollouts or A/B testing are needed:

1. Self-host Unleash on Railway
2. Replace boolean env vars with Unleash SDK calls
3. Add user context for targeting
4. Enable percentage rollouts

This keeps the simple boolean approach for now while preserving the evolution path.

## Security Considerations

1. **Secrets in env vars only**: Never hardcode secrets
2. **Build-time validation**: Missing secrets fail the build
3. **Server/client separation**: T3 Env enforces NEXT_PUBLIC_ prefix
4. **No debug in production**: Debug flags default to false

## References

- [T3 Env Documentation](https://env.t3.gg/docs/nextjs)
- [Turborepo Environment Variables](https://turborepo.com/docs/crafting-your-repository/using-environment-variables)
- [Feature Toggles Best Practices](https://martinfowler.com/articles/feature-toggles.html)
- [Unleash Documentation](https://docs.getunleash.io/)

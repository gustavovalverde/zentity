import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const TRAILING_SLASHES = /\/+$/;
const booleanTransform = (v: string) => v === "true" || v === "1";

const booleanString = z
  .enum(["true", "false", "0", "1"])
  .transform(booleanTransform);

const booleanStringWithDefault = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false", "0", "1"])
    .default(defaultValue)
    .transform(booleanTransform);

const serviceUrl = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) => s.replace(TRAILING_SLASHES, ""));

const KNOWN_INSECURE_SECRETS = new Set([
  "your-super-secret-key-change-in-production",
]);

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // Auth (required)
    BETTER_AUTH_SECRET: z
      .string()
      .min(1)
      .refine(
        (s) =>
          process.env.NODE_ENV !== "production" ||
          (s.length >= 32 && !KNOWN_INSECURE_SECRETS.has(s)),
        "BETTER_AUTH_SECRET must be at least 32 characters and not a known placeholder in production"
      ),
    OPAQUE_SERVER_SETUP: z.string().min(1),

    // Database
    TURSO_DATABASE_URL: z.string().default("file:./.data/dev.db"),
    TURSO_AUTH_TOKEN: z.string().optional(),
    DRIZZLE_LOG: booleanString.optional(),

    // Internal services
    FHE_SERVICE_URL: serviceUrl("http://localhost:5001"),
    OCR_SERVICE_URL: serviceUrl("http://localhost:5004"),
    SIGNER_COORDINATOR_URL: serviceUrl("http://localhost:5002"),
    SIGNER_ENDPOINTS: z
      .string()
      .default(
        "http://localhost:5101,http://localhost:5102,http://localhost:5103"
      )
      .transform((s) =>
        s
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
          .map((e) => e.replace(TRAILING_SLASHES, ""))
      ),
    INTERNAL_SERVICE_TOKEN: z.string().optional(),

    // Cryptographic secrets
    BBS_ISSUER_SECRET: z.string().optional(),
    RECOVERY_ML_KEM_SECRET_KEY: z.string().optional(),

    // Social login
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GENERIC_OAUTH_PROVIDERS: z.string().optional(),

    // Identity & auth
    PAIRWISE_SECRET: z.string().min(32).optional(),
    TRUSTED_ORIGINS: z.string().optional(),
    OIDC4VP_JWKS_URL: z.string().optional(),

    // Blockchain (server-only secrets/overrides)
    REGISTRAR_PRIVATE_KEY: z.string().optional(),
    FHEVM_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    LOCAL_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    LOCAL_RPC_URL: z.string().default("http://127.0.0.1:8545"),
    FHEVM_IDENTITY_REGISTRY: z.string().optional(),
    FHEVM_COMPLIANCE_RULES: z.string().optional(),
    FHEVM_COMPLIANT_ERC20: z.string().optional(),
    LOCAL_IDENTITY_REGISTRY: z.string().optional(),
    LOCAL_COMPLIANCE_RULES: z.string().optional(),
    LOCAL_COMPLIANT_ERC20: z.string().optional(),

    // Email
    MAILPIT_BASE_URL: z.string().optional(),
    MAILPIT_SEND_API_URL: z.string().optional(),
    MAILPIT_SEND_API_USERNAME: z.string().optional(),
    MAILPIT_SEND_API_PASSWORD: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM_EMAIL: z.string().default("no-reply@zentity.local"),
    MAIL_FROM_NAME: z.string().default("Zentity"),

    // Storage & ZK
    BB_CRS_PATH: z.string().default("/tmp/.bb-crs"),
    ZK_WARMUP_STRICT: booleanString.optional(),

    // Observability
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
    OTEL_ENABLED: booleanString.optional(),
    OTEL_SERVICE_NAME: z.string().default("zentity-web"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OTEL_METRICS_EXPORT_INTERVAL_MS: z.coerce.number().default(60_000),

    // Misc
    ZENTITY_ADMIN_API_KEY: z.string().optional(),
    DEMO_MODE: booleanString.optional(),
    E2E_OIDC_ONLY: booleanString.optional(),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
    NEXT_PUBLIC_APP_ENV: z.string().optional(),
    NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY: z.string().optional(),

    // Feature flags
    NEXT_PUBLIC_ENABLE_FHEVM: booleanStringWithDefault("true"),
    NEXT_PUBLIC_ENABLE_HARDHAT: booleanStringWithDefault("false"),
    NEXT_PUBLIC_ZKPASSPORT_ENABLED: booleanStringWithDefault("false"),

    // Web3
    NEXT_PUBLIC_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_FHEVM_RPC_URL: z
      .string()
      .default("https://ethereum-sepolia-rpc.publicnode.com"),

    // Noir/ZK client
    NEXT_PUBLIC_NOIR_DEBUG: booleanString.optional(),
    NEXT_PUBLIC_NOIR_WORKERS: z.coerce.number().optional(),
  },

  emptyStringAsUndefined: true,
  skipValidation:
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export",

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    OPAQUE_SERVER_SETUP: process.env.OPAQUE_SERVER_SETUP,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DRIZZLE_LOG: process.env.DRIZZLE_LOG,
    FHE_SERVICE_URL: process.env.FHE_SERVICE_URL,
    OCR_SERVICE_URL: process.env.OCR_SERVICE_URL,
    SIGNER_COORDINATOR_URL: process.env.SIGNER_COORDINATOR_URL,
    SIGNER_ENDPOINTS: process.env.SIGNER_ENDPOINTS,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
    BBS_ISSUER_SECRET: process.env.BBS_ISSUER_SECRET,
    RECOVERY_ML_KEM_SECRET_KEY: process.env.RECOVERY_ML_KEM_SECRET_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GENERIC_OAUTH_PROVIDERS: process.env.GENERIC_OAUTH_PROVIDERS,
    PAIRWISE_SECRET: process.env.PAIRWISE_SECRET,
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
    OIDC4VP_JWKS_URL: process.env.OIDC4VP_JWKS_URL,
    REGISTRAR_PRIVATE_KEY: process.env.REGISTRAR_PRIVATE_KEY,
    FHEVM_REGISTRAR_PRIVATE_KEY: process.env.FHEVM_REGISTRAR_PRIVATE_KEY,
    LOCAL_REGISTRAR_PRIVATE_KEY: process.env.LOCAL_REGISTRAR_PRIVATE_KEY,
    LOCAL_RPC_URL: process.env.LOCAL_RPC_URL,
    FHEVM_IDENTITY_REGISTRY: process.env.FHEVM_IDENTITY_REGISTRY,
    FHEVM_COMPLIANCE_RULES: process.env.FHEVM_COMPLIANCE_RULES,
    FHEVM_COMPLIANT_ERC20: process.env.FHEVM_COMPLIANT_ERC20,
    LOCAL_IDENTITY_REGISTRY: process.env.LOCAL_IDENTITY_REGISTRY,
    LOCAL_COMPLIANCE_RULES: process.env.LOCAL_COMPLIANCE_RULES,
    LOCAL_COMPLIANT_ERC20: process.env.LOCAL_COMPLIANT_ERC20,
    MAILPIT_BASE_URL: process.env.MAILPIT_BASE_URL,
    MAILPIT_SEND_API_URL: process.env.MAILPIT_SEND_API_URL,
    MAILPIT_SEND_API_USERNAME: process.env.MAILPIT_SEND_API_USERNAME,
    MAILPIT_SEND_API_PASSWORD: process.env.MAILPIT_SEND_API_PASSWORD,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    BB_CRS_PATH: process.env.BB_CRS_PATH,
    ZK_WARMUP_STRICT: process.env.ZK_WARMUP_STRICT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_METRICS_EXPORT_INTERVAL_MS:
      process.env.OTEL_METRICS_EXPORT_INTERVAL_MS,
    ZENTITY_ADMIN_API_KEY: process.env.ZENTITY_ADMIN_API_KEY,
    DEMO_MODE: process.env.DEMO_MODE,
    E2E_OIDC_ONLY: process.env.E2E_OIDC_ONLY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY,
    NEXT_PUBLIC_ENABLE_FHEVM: process.env.NEXT_PUBLIC_ENABLE_FHEVM,
    NEXT_PUBLIC_ENABLE_HARDHAT: process.env.NEXT_PUBLIC_ENABLE_HARDHAT,
    NEXT_PUBLIC_PROJECT_ID: process.env.NEXT_PUBLIC_PROJECT_ID,
    NEXT_PUBLIC_FHEVM_RPC_URL: process.env.NEXT_PUBLIC_FHEVM_RPC_URL,
    NEXT_PUBLIC_NOIR_DEBUG: process.env.NEXT_PUBLIC_NOIR_DEBUG,
    NEXT_PUBLIC_NOIR_WORKERS: process.env.NEXT_PUBLIC_NOIR_WORKERS,
    NEXT_PUBLIC_ZKPASSPORT_ENABLED: process.env.NEXT_PUBLIC_ZKPASSPORT_ENABLED,
  },
});

export const isWeb3Enabled =
  env.NEXT_PUBLIC_ENABLE_FHEVM || env.NEXT_PUBLIC_ENABLE_HARDHAT;

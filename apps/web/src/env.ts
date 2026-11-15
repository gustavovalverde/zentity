import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const TRAILING_SLASHES = /\/+$/;
const WORLD_ID_PRIVATE_KEY_HEX_REGEX = /^(0x)?[0-9a-fA-F]{64}$/;
const DEFAULT_MCP_PUBLIC_URL = "http://localhost:3300";
const booleanString = z.stringbool({
  truthy: ["true", "1"],
  falsy: ["false", "0"],
  case: "sensitive",
});

const isTruthyEnvValue = (value: string | undefined) =>
  value === "true" || value === "1";

/**
 * Public feature flags that gate at least one humanity-credential provider.
 * The HMAC secret is required when any of these is enabled. Extend this list
 * as new providers ship (e.g. NEXT_PUBLIC_PROOF_OF_HUMANITY_ENABLED).
 */
const HUMANITY_PROVIDER_FEATURE_FLAGS = [
  "NEXT_PUBLIC_WORLD_ID_ENABLED",
] as const;

const isAnyHumanityProviderEnabled = () =>
  HUMANITY_PROVIDER_FEATURE_FLAGS.some((flag) =>
    isTruthyEnvValue(process.env[flag])
  );

const booleanStringWithDefault = (defaultValue: boolean) =>
  booleanString.default(defaultValue);

/**
 * A wallet or key-attestation provider Zentity trusts (HAIP §4.4), identified
 * by key material: an inline JWK Set, a JWKS URL, or X.509 trust anchors.
 */
const TrustedIssuerSchema = z
  .object({
    issuer: z.string().min(1).optional(),
    jwks: z
      .object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) })
      .optional(),
    jwksUri: z.url().optional(),
    trustAnchors: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((entry) => entry.jwks || entry.jwksUri || entry.trustAnchors, {
    message: "each trusted issuer needs jwks, jwksUri, or trustAnchors",
  });

/** A JSON array of trusted issuers, for example `[{"issuer":"…","jwksUri":"…"}]`. */
const trustedIssuersJson = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "must be a JSON array of trusted issuers",
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(TrustedIssuerSchema).min(1));

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
    DOCUMENT_OCR_ENABLED: booleanStringWithDefault(false),
    INTERNAL_SERVICE_TOKEN: z
      .string()
      .optional()
      .refine(
        (s) => process.env.NODE_ENV !== "production" || (s && s.length >= 32),
        "INTERNAL_SERVICE_TOKEN must be at least 32 characters in production"
      ),
    // The agent wallet's audience: an absolute-URI identity for the wallet
    // instance, e.g. `urn:zentity:wallet:<jkt>`. When set,
    // payment_authorization tokens are minted with this as `aud` via an RFC
    // 8707 resource indicator, binding the token to that one wallet instance
    // (anti-redirection, PRD-43 D-5). A URN keeps the wallet key (not a network
    // host) as the identity, so DNS or BFF compromise cannot re-target the
    // token. It MUST be an absolute URI: the authorization server reaches `aud`
    // only through the resource-indicator seam, which rejects a bare thumbprint
    // (RFC 8707 §2). Absent → the mint fails closed for payment grants rather
    // than minting an unbound spend token.
    WALLET_AUDIENCE: z
      .string()
      .min(1)
      .refine(
        (value) => URL.canParse(value) && !value.includes("#"),
        "WALLET_AUDIENCE must be an absolute URI without a fragment (RFC 8707 §2); a bare thumbprint is rejected by the authorization server at mint"
      )
      .optional(),
    CRON_SECRET: z
      .string()
      .optional()
      .refine(
        (s) => process.env.NODE_ENV !== "production" || (s && s.length >= 32),
        "CRON_SECRET must be at least 32 characters in production"
      ),

    // Cryptographic secrets (independent from BETTER_AUTH_SECRET)
    CLAIM_SIGNING_SECRET: z.string().min(32),
    CIPHERTEXT_HMAC_SECRET: z.string().min(32),
    KEY_ENCRYPTION_KEY: z.string().min(32),
    BBS_ISSUER_SECRET: z.string().optional(),

    // Social login
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    // Identity & auth
    DEDUP_HMAC_SECRET: z.string().min(32),
    HUMANITY_HMAC_SECRET: z
      .string()
      .optional()
      .refine((value) => !value || value.length >= 32, {
        message: "HUMANITY_HMAC_SECRET must be at least 32 characters",
      })
      .refine((value) => !isAnyHumanityProviderEnabled() || Boolean(value), {
        message:
          "HUMANITY_HMAC_SECRET is required when any humanity provider is enabled",
      }),
    PAIRWISE_SECRET: z.string().min(32),
    TRUSTED_ORIGINS: z.string().optional(),
    OIDC4VP_JWKS_URL: z.string().optional(),
    TRUSTED_WALLET_ISSUERS: trustedIssuersJson.optional(),
    TRUSTED_AGENT_ATTESTERS: z.string().optional(),
    TRUSTED_SOFTWARE_STATEMENT_ISSUERS: z.string().optional(),
    MCP_PUBLIC_URL: z
      .string()
      .default(DEFAULT_MCP_PUBLIC_URL)
      .transform((value) => value.replace(TRAILING_SLASHES, "")),
    WORLD_ID_RP_ID: z
      .string()
      .optional()
      .refine((value) => !value || value.startsWith("rp_"), {
        message: "WORLD_ID_RP_ID must start with rp_",
      }),
    WORLD_ID_RP_SIGNING_KEY: z
      .string()
      .optional()
      .refine((value) => !value || WORLD_ID_PRIVATE_KEY_HEX_REGEX.test(value), {
        message: "WORLD_ID_RP_SIGNING_KEY must be a 32-byte hex private key",
      }),
    WORLD_ID_VERIFY_URL: serviceUrl(
      "https://developer.world.org/api/v4/verify"
    ),
    WORLD_ID_ENVIRONMENT: z
      .enum(["production", "staging"])
      .default("production"),
    WORLD_ID_RP_SIGNATURE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    // Blockchain (server-only secrets/overrides)
    CONFIDENTIAL_CHAIN_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    CONFIDENTIAL_CHAIN_IDENTITY_REGISTRY: z.string().optional(),
    CONFIDENTIAL_CHAIN_COMPLIANCE_RULES: z.string().optional(),
    CONFIDENTIAL_CHAIN_COMPLIANT_ERC20: z.string().optional(),
    CONFIDENTIAL_RELAYER_URL: serviceUrl("https://relayer.testnet.zama.org"),
    CONFIDENTIAL_RELAYER_API_KEY: z.string().optional(),
    LOCAL_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    LOCAL_RPC_URL: z.string().default("http://127.0.0.1:8545"),
    BASE_SEPOLIA_RPC_URL: z.string().default("https://sepolia.base.org"),
    BASE_SEPOLIA_REGISTRAR_PRIVATE_KEY: z.string().optional(),
    BASE_SEPOLIA_IDENTITY_REGISTRY_MIRROR: z.string().optional(),
    LOCAL_IDENTITY_REGISTRY: z.string().optional(),
    LOCAL_COMPLIANCE_RULES: z.string().optional(),
    LOCAL_COMPLIANT_ERC20: z.string().optional(),

    // Web Push (VAPID)
    VAPID_PUBLIC_KEY: z
      .string()
      .optional()
      .refine(
        (s) => process.env.NODE_ENV !== "production" || !!s,
        "VAPID_PUBLIC_KEY is required in production"
      ),
    VAPID_PRIVATE_KEY: z
      .string()
      .optional()
      .refine(
        (s) => process.env.NODE_ENV !== "production" || !!s,
        "VAPID_PRIVATE_KEY is required in production"
      ),
    VAPID_SUBJECT: z.string().default("mailto:notifications@zentity.xyz"),

    // Email
    MAILPIT_BASE_URL: z.string().optional(),
    MAILPIT_SEND_API_URL: z.string().optional(),
    MAILPIT_SEND_API_USERNAME: z.string().optional(),
    MAILPIT_SEND_API_PASSWORD: z.string().optional(),
    RESEND_API_KEY: z
      .string()
      .optional()
      .refine(
        (s) => process.env.NODE_ENV !== "production" || !!s,
        "RESEND_API_KEY is required in production"
      ),
    MAIL_FROM_EMAIL: z.string().default("no-reply@zentity.local"),
    MAIL_FROM_NAME: z.string().default("Zentity"),

    // Storage & ZK
    SECRET_BLOB_DIR: z.string().default(".data/secret-blobs"),
    BB_CRS_PATH: z.string().default("/tmp/.bb-crs"),
    ZK_WARMUP_STRICT: booleanStringWithDefault(true),

    // Observability. The OpenTelemetry SDK reads the other standard OTEL_*
    // variables itself; these decide whether it starts and name the service.
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).optional(),
    OTEL_ENABLED: booleanString.optional(),
    OTEL_SERVICE_NAME: z.string().default("zentity-web"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.string().optional(),

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
    NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN: booleanStringWithDefault(true),
    NEXT_PUBLIC_ENABLE_HARDHAT: booleanStringWithDefault(false),
    NEXT_PUBLIC_ENABLE_BASE_SEPOLIA: booleanStringWithDefault(false),
    NEXT_PUBLIC_ZKPASSPORT_ENABLED: booleanStringWithDefault(false),
    NEXT_PUBLIC_WORLD_ID_ENABLED: booleanStringWithDefault(false),
    NEXT_PUBLIC_WORLD_ID_APP_ID: z
      .string()
      .optional()
      .refine((value) => !value || value.startsWith("app_"), {
        message: "NEXT_PUBLIC_WORLD_ID_APP_ID must start with app_",
      }),

    // Web3
    NEXT_PUBLIC_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL: z
      .string()
      .default("https://ethereum-sepolia-rpc.publicnode.com"),
    NEXT_PUBLIC_LOCAL_RPC_URL: z.string().default("http://127.0.0.1:8545"),
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: z
      .string()
      .default("https://sepolia.base.org"),
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT: booleanStringWithDefault(true),
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED: booleanStringWithDefault(true),
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963: booleanStringWithDefault(true),
    NEXT_PUBLIC_APPKIT_ENABLE_COINBASE: booleanStringWithDefault(true),
    NEXT_PUBLIC_APPKIT_ANALYTICS: booleanStringWithDefault(true),

    // Web Push
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),

    // Noir/ZK client
    NEXT_PUBLIC_NOIR_DEBUG: booleanString.optional(),
    NEXT_PUBLIC_NOIR_WORKERS: z.coerce.number().optional(),
  },

  emptyStringAsUndefined: true,
  skipValidation:
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export",

  // Server variables are read from process.env at runtime. Next inlines client
  // variables only from literal process.env.NEXT_PUBLIC_* references, so those
  // stay listed.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY,
    NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN:
      process.env.NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN,
    NEXT_PUBLIC_ENABLE_HARDHAT: process.env.NEXT_PUBLIC_ENABLE_HARDHAT,
    NEXT_PUBLIC_ENABLE_BASE_SEPOLIA:
      process.env.NEXT_PUBLIC_ENABLE_BASE_SEPOLIA,
    NEXT_PUBLIC_PROJECT_ID: process.env.NEXT_PUBLIC_PROJECT_ID,
    NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL:
      process.env.NEXT_PUBLIC_CONFIDENTIAL_CHAIN_RPC_URL,
    NEXT_PUBLIC_LOCAL_RPC_URL: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL:
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT:
      process.env.NEXT_PUBLIC_APPKIT_ENABLE_WALLETCONNECT,
    NEXT_PUBLIC_APPKIT_ENABLE_INJECTED:
      process.env.NEXT_PUBLIC_APPKIT_ENABLE_INJECTED,
    NEXT_PUBLIC_APPKIT_ENABLE_EIP6963:
      process.env.NEXT_PUBLIC_APPKIT_ENABLE_EIP6963,
    NEXT_PUBLIC_APPKIT_ENABLE_COINBASE:
      process.env.NEXT_PUBLIC_APPKIT_ENABLE_COINBASE,
    NEXT_PUBLIC_APPKIT_ANALYTICS: process.env.NEXT_PUBLIC_APPKIT_ANALYTICS,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_NOIR_DEBUG: process.env.NEXT_PUBLIC_NOIR_DEBUG,
    NEXT_PUBLIC_NOIR_WORKERS: process.env.NEXT_PUBLIC_NOIR_WORKERS,
    NEXT_PUBLIC_ZKPASSPORT_ENABLED: process.env.NEXT_PUBLIC_ZKPASSPORT_ENABLED,
    NEXT_PUBLIC_WORLD_ID_ENABLED: process.env.NEXT_PUBLIC_WORLD_ID_ENABLED,
    NEXT_PUBLIC_WORLD_ID_APP_ID: process.env.NEXT_PUBLIC_WORLD_ID_APP_ID,
  },
});

export const isWeb3Enabled =
  env.NEXT_PUBLIC_ENABLE_CONFIDENTIAL_CHAIN || env.NEXT_PUBLIC_ENABLE_HARDHAT;

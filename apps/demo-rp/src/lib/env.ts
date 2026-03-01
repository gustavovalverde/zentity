import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const TRAILING_SLASHES = /\/+$/;

const KNOWN_INSECURE_SECRETS = new Set(["demo-rp-secret-at-least-32-chars"]);

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    BETTER_AUTH_SECRET: z
      .string()
      .min(1)
      .refine(
        (s) =>
          process.env.NODE_ENV !== "production" ||
          (s.length >= 32 && !KNOWN_INSECURE_SECRETS.has(s)),
        "BETTER_AUTH_SECRET must be at least 32 characters and not a known placeholder in production"
      ),

    ZENTITY_URL: z
      .string()
      .default("http://localhost:3000")
      .transform((s) => s.replace(TRAILING_SLASHES, "")),

    DATABASE_URL: z.string().default("file:./.data/demo-rp.db"),
    DATABASE_AUTH_TOKEN: z.string().optional(),

    OIDC4VCI_WALLET_CLIENT_ID: z.string().default("zentity-wallet"),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3102"),
  },

  emptyStringAsUndefined: true,
  skipValidation: process.env.NEXT_PHASE === "phase-production-build",

  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    ZENTITY_URL: process.env.ZENTITY_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    OIDC4VCI_WALLET_CLIENT_ID: process.env.OIDC4VCI_WALLET_CLIENT_ID,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
});

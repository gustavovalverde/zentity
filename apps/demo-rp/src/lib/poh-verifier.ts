import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/lib/env";

// Lazy JWKS init: see verify.ts for rationale (Next.js build skipValidation).
let pohJwksInstance: ReturnType<typeof createRemoteJWKSet> | undefined;
function pohJwks() {
  pohJwksInstance ??= createRemoteJWKSet(
    new URL("/api/auth/oauth2/jwks", env.ZENTITY_URL)
  );
  return pohJwksInstance;
}

export interface PohClaims {
  method: "ocr" | "nfc_chip" | null;
  sybil_resistant: boolean;
  tier: number;
  verified: boolean;
}

export interface VerifiedPohToken {
  cnf?: { jkt: string } | undefined;
  exp: number;
  poh: PohClaims;
  sub: string;
}

export async function verifyPohToken(token: string): Promise<VerifiedPohToken> {
  const { payload } = await jwtVerify(token, pohJwks(), {
    issuer: env.NEXT_PUBLIC_ZENTITY_URL,
    algorithms: ["EdDSA"],
  });

  const poh = payload.poh as PohClaims | undefined;
  if (!poh || typeof poh.tier !== "number") {
    throw new Error("PoH token missing poh claim");
  }

  return {
    sub: payload.sub as string,
    exp: payload.exp as number,
    poh: {
      tier: poh.tier,
      verified: Boolean(poh.verified),
      sybil_resistant: Boolean(poh.sybil_resistant),
      method: poh.method ?? null,
    },
    cnf: payload.cnf as { jkt: string } | undefined,
  };
}

import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/lib/env";

const pohJwks = createRemoteJWKSet(
  new URL("/api/auth/oauth2/jwks", env.ZENTITY_URL)
);

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
  const { payload } = await jwtVerify(token, pohJwks, {
    issuer: env.ZENTITY_URL,
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

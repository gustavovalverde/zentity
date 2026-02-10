import "server-only";

import { constantTimeEqual, makeSignature } from "better-auth/crypto";

import { getBetterAuthSecret } from "@/lib/utils/env";

export async function verifySignedOAuthQuery(
  query: string
): Promise<URLSearchParams> {
  const params = new URLSearchParams(query);
  const sig = params.get("sig");
  const exp = Number(params.get("exp"));
  params.delete("sig");

  const verifySig = await makeSignature(
    params.toString(),
    getBetterAuthSecret()
  );
  if (
    !(sig && constantTimeEqual(sig, verifySig)) ||
    Number.isNaN(exp) ||
    new Date(exp * 1000) < new Date()
  ) {
    throw new Error("invalid_signature");
  }

  params.delete("exp");
  return params;
}

export function parseRequestedScopes(queryParams: URLSearchParams): string[] {
  return (queryParams.get("scope") ?? "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

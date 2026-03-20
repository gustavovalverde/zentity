import { NextResponse } from "next/server";

import { getAttestationJwks } from "@/lib/attestation";

export async function GET() {
  const jwks = await getAttestationJwks();
  return NextResponse.json(jwks, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}

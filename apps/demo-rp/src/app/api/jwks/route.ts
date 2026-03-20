import { NextResponse } from "next/server";

import { getPublicJwk } from "@/lib/attestation";

export async function GET() {
  const publicJwk = await getPublicJwk();
  return NextResponse.json(
    { keys: [publicJwk] },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/json",
      },
    }
  );
}

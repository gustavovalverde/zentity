import { NextResponse } from "next/server";

import { acquirePohToken, isPohError } from "@/lib/poh-client";

export async function POST() {
  const result = await acquirePohToken();

  if (isPohError(result)) {
    return NextResponse.json(
      { error: result.error, error_description: result.error_description },
      { status: result.status }
    );
  }

  return NextResponse.json({
    token: result.token,
    claims: result.claims,
  });
}

import { NextResponse } from "next/server";

import { env } from "@/env";
import { ingestChainRevocations } from "@/lib/identity/validity/chain-ingest";

function isAuthorized(request: Request): boolean {
  const expectedKey = env.ZENTITY_ADMIN_API_KEY;
  if (!expectedKey) {
    return false;
  }

  return request.headers.get("x-zentity-admin-key") === expectedKey;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    fromBlock?: number;
    networkId?: string;
  } | null;

  if (!body?.networkId) {
    return NextResponse.json(
      { error: "networkId is required" },
      { status: 400 }
    );
  }

  const result = await ingestChainRevocations({
    networkId: body.networkId,
    ...(typeof body.fromBlock === "number"
      ? { fromBlock: body.fromBlock }
      : {}),
  });

  return NextResponse.json(result);
}

import { NextResponse } from "next/server";

import { requireAdminApiKey } from "@/lib/http/admin-auth";
import { ingestChainValidityEvents } from "@/lib/identity/validity/chain-ingest";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) {
    return unauthorized;
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

  const result = await ingestChainValidityEvents({
    networkId: body.networkId,
    ...(typeof body.fromBlock === "number"
      ? { fromBlock: body.fromBlock }
      : {}),
  });

  return NextResponse.json(result);
}

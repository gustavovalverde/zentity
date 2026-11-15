import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiKey } from "@/lib/http/admin-auth";
import { ingestChainValidityEvents } from "@/lib/identity/validity/chain-ingest";

const bodySchema = z.object({
  fromBlock: z.number().int().nonnegative().optional(),
  networkId: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireAdminApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const parsedBody = bodySchema.safeParse(
    (await request.json().catch(() => null)) as unknown
  );
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid chain ingest payload",
        issues: z.flattenError(parsedBody.error),
      },
      { status: 400 }
    );
  }

  const { fromBlock, networkId } = parsedBody.data;
  const result = await ingestChainValidityEvents({
    networkId,
    ...(fromBlock === undefined ? {} : { fromBlock }),
  });

  return NextResponse.json(result);
}

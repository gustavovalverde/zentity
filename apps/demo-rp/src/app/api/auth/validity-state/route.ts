import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { isValidProviderId } from "@/lib/dcr";
import { getProviderValidityState } from "@/lib/validity";

export async function GET(request: Request): Promise<Response> {
  const providerId = new URL(request.url).searchParams.get("providerId");
  if (!(providerId && isValidProviderId(providerId))) {
    return NextResponse.json(
      { error: "Invalid or missing providerId" },
      { status: 400 }
    );
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const validityState = await getProviderValidityState({
    providerId,
    userId: session.user.id,
  });

  return NextResponse.json(validityState, {
    headers: { "Cache-Control": "no-store" },
  });
}

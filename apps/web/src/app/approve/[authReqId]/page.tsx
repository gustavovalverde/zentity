import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ authReqId: string }>;
}) {
  const { authReqId } = await params;
  const session = await getCachedSession(await headers());
  let authMode: AuthMode = null;
  let wallet: { address: string; chainId: number } | null = null;

  if (session?.user?.id) {
    const detected = await detectAuthMode(session.user.id);
    authMode = detected.authMode;
    wallet = detected.wallet;
  }

  // Fetch agent claims from DB (the verify endpoint doesn't expose them)
  const cibaRow = await db
    .select({ agentClaims: cibaRequests.agentClaims })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .limit(1)
    .get();

  const agentClaims = cibaRow?.agentClaims
    ? (JSON.parse(cibaRow.agentClaims) as Record<string, unknown>)
    : null;

  return (
    <div className="w-full max-w-md">
      <CibaApproveClient
        agentClaims={agentClaims}
        authMode={authMode}
        authReqId={authReqId}
        wallet={wallet}
      />
      <div className="mt-4 hidden text-center md:block">
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href={`/dashboard/ciba/approve?auth_req_id=${encodeURIComponent(authReqId)}`}
        >
          View in dashboard
        </Link>
      </div>
    </div>
  );
}

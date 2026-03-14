import { headers } from "next/headers";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";

export default async function CibaApprovePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getCachedSession(await headers());
  let authMode: AuthMode = null;
  let wallet: { address: string; chainId: number } | null = null;

  if (session?.user?.id) {
    const detected = await detectAuthMode(session.user.id);
    authMode = detected.authMode;
    wallet = detected.wallet;
  }

  const params = await searchParams;
  const authReqId =
    typeof params.auth_req_id === "string" ? params.auth_req_id : null;

  return (
    <CibaApproveClient
      authMode={authMode}
      authReqId={authReqId}
      wallet={wallet}
    />
  );
}

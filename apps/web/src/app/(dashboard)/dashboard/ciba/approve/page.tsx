import { headers } from "next/headers";

import { getCachedSession } from "@/lib/auth/cached-session";
import { type AuthMode, detectAuthMode } from "@/lib/auth/detect-auth-mode";

import { CibaApproveClient } from "./ciba-approve-client";

export default async function CibaApprovePage() {
  const session = await getCachedSession(await headers());
  let authMode: AuthMode = null;
  let wallet: { address: string; chainId: number } | null = null;

  if (session?.user?.id) {
    const detected = await detectAuthMode(session.user.id);
    authMode = detected.authMode;
    wallet = detected.wallet;
  }

  return <CibaApproveClient authMode={authMode} wallet={wallet} />;
}

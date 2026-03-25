import { headers } from "next/headers";

import { CibaApproveClient } from "@/components/ciba/ciba-approve-client";
import { getAccountAssurance } from "@/lib/assurance/data";
import { getFreshSession } from "@/lib/auth/cached-session";
import { detectAuthMode } from "@/lib/auth/detect-auth-mode";
import { resolveCibaApprovalData } from "@/lib/ciba/resolve-approval";

export default async function CibaApprovePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const authReqId =
    typeof params.auth_req_id === "string" ? params.auth_req_id : null;

  const session = await getFreshSession(await headers());

  if (!session?.user?.id) {
    return (
      <CibaApproveClient
        authMode={null}
        authReqId={authReqId}
        userTier={0}
        wallet={null}
      />
    );
  }

  const [detected, assurance, approval] = await Promise.all([
    detectAuthMode(session.user.id),
    getAccountAssurance(session.user.id),
    authReqId
      ? resolveCibaApprovalData(authReqId, session.user.id)
      : Promise.resolve(null),
  ]);

  return (
    <CibaApproveClient
      agentIdentity={approval?.agentIdentity ?? null}
      authMode={detected.authMode}
      authReqId={authReqId}
      registeredAgent={approval?.registeredAgent ?? null}
      userTier={assurance.tier}
      wallet={detected.wallet}
      {...(approval ? { initialRequest: approval.request } : {})}
    />
  );
}

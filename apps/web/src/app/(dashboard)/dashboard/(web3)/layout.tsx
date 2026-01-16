import { headers } from "next/headers";

import { Web3Provider } from "@/components/providers/web3-provider";
import { getCachedSession } from "@/lib/auth/cached-session";

export default async function Web3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  const cookies = headersObj.get("cookie");
  const walletScopeId = session?.user?.id ?? null;

  return (
    <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
      {children}
    </Web3Provider>
  );
}

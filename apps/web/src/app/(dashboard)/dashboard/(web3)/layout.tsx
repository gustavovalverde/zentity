import { headers } from "next/headers";

import { Web3Provider } from "@/components/providers/web3-provider";
import { auth } from "@/lib/auth/auth";

export default async function Web3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersObj = await headers();
  const session = await auth.api.getSession({
    headers: headersObj,
  });
  const cookies = headersObj.get("cookie");
  const walletScopeId = session?.user?.id ?? null;

  return (
    <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
      {children}
    </Web3Provider>
  );
}

import { headers } from "next/headers";

import { Web3Provider } from "@/components/providers/web3-provider";

export default async function Web3Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");

  return <Web3Provider cookies={cookies}>{children}</Web3Provider>;
}

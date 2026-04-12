import { headers } from "next/headers";

import { Web3Provider } from "@/components/providers/web3-provider";
import { StandaloneLayout } from "@/components/standalone-layout";

export default async function ApproveLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");

  return (
    <StandaloneLayout cookies={cookies}>
      <Web3Provider cookies={cookies}>{children}</Web3Provider>
    </StandaloneLayout>
  );
}

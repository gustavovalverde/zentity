import { headers } from "next/headers";

import { StandaloneLayout } from "@/components/chrome/standalone-layout";
import { Web3Provider } from "@/components/providers/web3-provider";

/**
 * Shared layout for decision UIs: CIBA approval, MCP interactive auth, OAuth
 * consent. All three render outside the dashboard chrome and require
 * wallet access for vault unlock / identity disclosure, so Web3Provider is
 * included unconditionally. Pages that don't need wallet integration still
 * pay a small provider mount cost.
 */
export default async function ConsentLayout({
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

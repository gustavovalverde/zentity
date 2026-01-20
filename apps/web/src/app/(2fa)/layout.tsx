import { headers } from "next/headers";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { TrpcProvider } from "@/components/providers/trpc-provider";
import { Web3Provider } from "@/components/providers/web3-provider";
import { getCachedSession } from "@/lib/auth/cached-session";

export default async function TwoFactorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  const cookies = headersObj.get("cookie");
  const walletScopeId = session?.user?.id ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <ModeToggle />
        </nav>
      </header>
      <main
        className="flex flex-1 items-center justify-center px-4 py-12"
        id="main-content"
      >
        <TrpcProvider>
          <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
            <PasskeyAuthProvider>
              <BetterAuthUIProvider>{children}</BetterAuthUIProvider>
            </PasskeyAuthProvider>
          </Web3Provider>
        </TrpcProvider>
      </main>
    </div>
  );
}

import { headers } from "next/headers";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { TrpcProvider } from "@/components/providers/trpc-provider";
import { Web3Provider } from "@/components/providers/web3-provider";

export default async function TwoFactorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");
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
          <Web3Provider cookies={cookies}>
            <PasskeyAuthProvider>
              <BetterAuthUIProvider>{children}</BetterAuthUIProvider>
            </PasskeyAuthProvider>
          </Web3Provider>
        </TrpcProvider>
      </main>
    </div>
  );
}

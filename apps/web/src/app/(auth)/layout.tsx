import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { TrpcProvider } from "@/components/providers/trpc-provider";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <TrpcProvider>
          <PasskeyAuthProvider>
            <BetterAuthUIProvider>{children}</BetterAuthUIProvider>
          </PasskeyAuthProvider>
        </TrpcProvider>
      </main>
    </div>
  );
}

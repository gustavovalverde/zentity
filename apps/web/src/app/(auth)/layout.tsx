import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <BetterAuthUIProvider>{children}</BetterAuthUIProvider>
      </main>
    </div>
  );
}

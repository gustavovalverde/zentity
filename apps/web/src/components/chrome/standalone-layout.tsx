import Link from "next/link";

import { Logo } from "@/components/chrome/logo";
import { ModeToggle } from "@/components/chrome/mode-toggle";
import { QueryProvider } from "@/components/providers/query-provider";

interface StandaloneLayoutProps {
  children: React.ReactNode;
}

export function StandaloneLayout({
  children,
}: Readonly<StandaloneLayoutProps>) {
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
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}

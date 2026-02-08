import { headers } from "next/headers";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { QueryProvider } from "@/components/providers/query-provider";
import { Web3Provider } from "@/components/providers/web3-provider";

export default async function ConsentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const cookies = headersList.get("cookie");

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
        <QueryProvider>
          <Web3Provider cookies={cookies}>{children}</Web3Provider>
        </QueryProvider>
      </main>
    </div>
  );
}

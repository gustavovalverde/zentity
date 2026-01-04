import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DynamicBreadcrumb } from "@/components/dashboard/dynamic-breadcrumb";
import { ModeToggle } from "@/components/mode-toggle";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { Web3Provider } from "@/components/providers/web3-provider";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/auth/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersObj = await headers();
  const session = await auth.api.getSession({
    headers: headersObj,
  });

  if (!session) {
    redirect("/sign-in");
  }

  const cookies = headersObj.get("cookie");
  const walletScopeId = session.user?.id ?? null;

  return (
    <PasskeyAuthProvider>
      <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
        <SidebarProvider>
          <AppSidebar user={session.user} />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator className="mr-2 h-4" orientation="vertical" />
              <DynamicBreadcrumb />
              <div className="ml-auto">
                <ModeToggle />
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
            <footer className="border-t px-4 py-4">
              <div className="mx-auto max-w-6xl text-center text-muted-foreground text-xs">
                <Link
                  className="text-muted-foreground/70 hover:text-muted-foreground"
                  href="/api/build-info"
                >
                  Verify build attestation
                </Link>
              </div>
            </footer>
          </SidebarInset>
        </SidebarProvider>
      </Web3Provider>
    </PasskeyAuthProvider>
  );
}

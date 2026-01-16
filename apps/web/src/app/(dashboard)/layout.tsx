import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DynamicBreadcrumb } from "@/components/dashboard/dynamic-breadcrumb";
import { HeaderActions } from "@/components/dashboard/header-actions";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { TrpcProvider } from "@/components/providers/trpc-provider";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getCachedSession } from "@/lib/auth/cached-session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <TrpcProvider>
      <PasskeyAuthProvider>
        <BetterAuthUIProvider>
          <SidebarProvider>
            <AppSidebar user={session.user} />
            <SidebarInset>
              <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator className="mr-2 h-4" orientation="vertical" />
                <DynamicBreadcrumb />
                <HeaderActions />
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
        </BetterAuthUIProvider>
      </PasskeyAuthProvider>
    </TrpcProvider>
  );
}

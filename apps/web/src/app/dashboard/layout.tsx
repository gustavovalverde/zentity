import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ModeToggle } from "@/components/chrome/mode-toggle";
import { PrivacyToggle } from "@/components/chrome/privacy-toggle";
import { BetterAuthUIProvider } from "@/components/providers/auth-ui-provider";
import { PasskeyAuthProvider } from "@/components/providers/passkey-auth-provider";
import { TrpcProvider } from "@/components/providers/trpc-provider";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getCachedSession } from "@/lib/auth/session";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";

import { AppSidebar } from "./_components/app-sidebar";
import { DynamicBreadcrumb } from "./_components/dynamic-breadcrumb";
import { EmailVerificationBanner } from "./_components/email-verification-banner";
import { FheBackgroundKeygen } from "./_components/fhe-lifecycle";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);

  if (!session) {
    redirect("/sign-in");
  }

  const bundle = await getIdentityBundleByUserId(session.user.id);
  const hasEnrollment = Boolean(bundle?.fheKeyId);

  return (
    <TrpcProvider>
      <FheBackgroundKeygen hasEnrollment={hasEnrollment} />
      <PasskeyAuthProvider>
        <BetterAuthUIProvider>
          <SidebarProvider>
            <AppSidebar user={session.user} />
            <SidebarInset>
              <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator className="mr-2 h-4" orientation="vertical" />
                <DynamicBreadcrumb />
                <div className="ml-auto flex items-center gap-2">
                  <PrivacyToggle />
                  <ModeToggle />
                </div>
              </header>
              <main className="flex-1 p-4 md:p-6" id="main-content">
                <div className="mx-auto max-w-6xl">
                  <EmailVerificationBanner
                    email={session.user.email}
                    emailVerified={session.user.emailVerified}
                  />
                  {children}
                </div>
              </main>
              <footer className="border-t px-4 py-4">
                <div className="mx-auto max-w-6xl text-center text-muted-foreground text-xs">
                  <Link
                    className="text-muted-foreground/70 hover:text-muted-foreground"
                    href="/api/status/build-info"
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

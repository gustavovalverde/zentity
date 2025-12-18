import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { auth } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <Link
              href="/dashboard/settings"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
            <SignOutButton />
            <ModeToggle />
          </div>
        </nav>
      </header>
      <main className="flex-1 py-8">
        <div className="mx-auto max-w-6xl px-4">{children}</div>
      </main>
      <footer className="border-t border-border py-4">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground">
          <Link
            href="/api/build-info"
            className="text-muted-foreground/70 hover:text-muted-foreground"
          >
            Verify build attestation
          </Link>
        </div>
      </footer>
    </div>
  );
}

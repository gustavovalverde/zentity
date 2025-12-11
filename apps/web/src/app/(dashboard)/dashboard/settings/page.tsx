import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthMethodsSection } from "@/components/dashboard/auth-methods-section";
import { ChangePasswordSection } from "@/components/dashboard/change-password-section";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Get linked accounts from session/database
  // Better Auth stores accounts in the "account" table
  // For now, we'll show a simplified view
  // In production, you'd query the accounts table

  const linkedAccounts: { provider: string; providerId: string }[] = [];

  // TODO: Fetch actual linked accounts from Better Auth
  // const accounts = await db.query.account.findMany({
  //   where: eq(account.userId, session.user.id),
  // });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your account settings and authentication methods
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>

      <AuthMethodsSection
        email={session.user.email}
        hasPassword={true} // Users created via signup have password
        linkedAccounts={linkedAccounts}
      />

      <ChangePasswordSection />
    </div>
  );
}

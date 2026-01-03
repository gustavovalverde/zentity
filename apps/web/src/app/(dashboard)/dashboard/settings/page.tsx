import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthMethodsSection } from "@/components/dashboard/auth-methods-section";
import { ChangePasswordSection } from "@/components/dashboard/change-password-section";
import { DeleteAccountSection } from "@/components/dashboard/delete-account-section";
import { PasskeyManagementSection } from "@/components/dashboard/passkey-management-section";
import { UserDataSection } from "@/components/dashboard/user-data-section";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth/auth";
import { userHasPassword } from "@/lib/db/queries/auth";

export default async function SettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Check if user has a password set (for passwordless users)
  const hasPassword = await userHasPassword(session.user.id);

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
          <h1 className="font-bold text-3xl">Settings</h1>
          <p className="text-muted-foreground">
            Manage your account settings and authentication methods
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>

      <UserDataSection />

      <PasskeyManagementSection />

      <AuthMethodsSection
        email={session.user.email}
        hasPassword={hasPassword}
        linkedAccounts={linkedAccounts}
      />

      <ChangePasswordSection hasPassword={hasPassword} />

      <DeleteAccountSection email={session.user.email} />
    </div>
  );
}

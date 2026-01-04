import { Key, Shield, User } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthMethodsSection } from "@/components/dashboard/auth-methods-section";
import { ChangePasswordSection } from "@/components/dashboard/change-password-section";
import { DeleteAccountSection } from "@/components/dashboard/delete-account-section";
import { PasskeyManagementSection } from "@/components/dashboard/passkey-management-section";
import { UserDataSection } from "@/components/dashboard/user-data-section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  // For now, we'll show a simplified view
  const linkedAccounts: { provider: string; providerId: string }[] = [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account settings and security
        </p>
      </div>

      <Tabs className="w-full" defaultValue="security">
        <TabsList>
          <TabsTrigger className="gap-1.5" value="security">
            <Key className="h-4 w-4" />
            <span className="hidden sm:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="data">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Data</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="account">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-6 space-y-6" value="security">
          <PasskeyManagementSection />
          <AuthMethodsSection
            email={session.user.email}
            hasPassword={hasPassword}
            linkedAccounts={linkedAccounts}
          />
          <ChangePasswordSection hasPassword={hasPassword} />
        </TabsContent>

        <TabsContent className="mt-6 space-y-6" value="data">
          <UserDataSection />
        </TabsContent>

        <TabsContent className="mt-6 space-y-6" value="account">
          <DeleteAccountSection email={session.user.email} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { eq } from "drizzle-orm";
import { KeyRound, LifeBuoy, Settings, User } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConnectedAppsCard } from "@/components/dashboard/connected-apps-card";
import { DeleteAccountSection } from "@/components/dashboard/delete-account-section";
import { PasskeyManagementSection } from "@/components/dashboard/passkey-management-section";
import { PasswordSection } from "@/components/dashboard/password-section";
import { RecoverySetupSection } from "@/components/dashboard/recovery-setup-section";
import {
  ConnectedAccountsCard,
  SessionsCard,
} from "@/components/dashboard/security-cards";
import { TwoFactorCard } from "@/components/dashboard/two-factor-card";
import { UserDataSection } from "@/components/dashboard/user-data-section";
import { WalletBindingSection } from "@/components/dashboard/wallet-binding-section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { userHasPassword } from "@/lib/db/queries/auth";
import { oauthClients, oauthConsents } from "@/lib/db/schema/oauth-provider";

export default async function SettingsPage() {
  const session = await getCachedSession(await headers());

  if (!session) {
    redirect("/sign-in");
  }

  const [hasPassword, consents] = await Promise.all([
    userHasPassword(session.user.id),
    db
      .select({
        consentId: oauthConsents.id,
        clientId: oauthConsents.clientId,
        scopes: oauthConsents.scopes,
        createdAt: oauthConsents.createdAt,
        updatedAt: oauthConsents.updatedAt,
        clientName: oauthClients.name,
        clientIcon: oauthClients.icon,
        clientUri: oauthClients.uri,
      })
      .from(oauthConsents)
      .innerJoin(
        oauthClients,
        eq(oauthConsents.clientId, oauthClients.clientId)
      )
      .where(eq(oauthConsents.userId, session.user.id)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account settings, security, and recovery options
        </p>
      </div>

      <Tabs className="w-full" defaultValue="security">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger className="gap-1.5" value="security">
            <KeyRound className="h-4 w-4" />
            <span className="hidden sm:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="recovery">
            <LifeBuoy className="h-4 w-4" />
            <span className="hidden sm:inline">Recovery</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="profile">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Profile</span>
          </TabsTrigger>
          <TabsTrigger className="gap-1.5" value="account">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
        </TabsList>

        {/* SECURITY TAB - Authentication methods */}
        <TabsContent className="mt-6 space-y-6" value="security">
          <SectionHeader
            description="Manage how you sign in to your account"
            title="Authentication"
          />
          <PasskeyManagementSection />
          <TwoFactorCard hasPassword={hasPassword} />
          <PasswordSection hasPassword={hasPassword} />
          <WalletBindingSection />
        </TabsContent>

        {/* RECOVERY TAB - Backup access options */}
        <TabsContent className="mt-6 space-y-6" value="recovery">
          <SectionHeader
            description="Set up backup options in case you lose access to your passkey"
            title="Account Recovery"
          />
          <RecoverySetupSection />
        </TabsContent>

        {/* PROFILE TAB - Your verified information */}
        <TabsContent className="mt-6 space-y-6" value="profile">
          <SectionHeader
            description="View your verified identity information"
            title="Your Information"
          />
          <UserDataSection />
        </TabsContent>

        {/* ACCOUNT TAB - Sessions, connections, and danger zone */}
        <TabsContent className="mt-6 space-y-6" value="account">
          <SectionHeader
            description="Manage your active sessions and connected services"
            title="Sessions & Connections"
          />
          <SessionsCard />
          <ConnectedAppsCard consents={consents} />
          <ConnectedAccountsCard />

          <div className="pt-6">
            <SectionHeader
              description="Irreversible actions that affect your account"
              title="Danger Zone"
              variant="danger"
            />
            <div className="mt-4">
              <DeleteAccountSection email={session.user.email} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  variant = "default",
}: Readonly<{
  title: string;
  description: string;
  variant?: "default" | "danger";
}>) {
  return (
    <div className="space-y-1">
      <h2
        className={`font-semibold text-lg ${variant === "danger" ? "text-destructive" : ""}`}
      >
        {title}
      </h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

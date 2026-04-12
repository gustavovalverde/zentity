import { eq } from "drizzle-orm";
import {
  KeyRound,
  LifeBuoy,
  Settings,
  TriangleAlert,
  User,
} from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/chrome/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCachedSession } from "@/lib/auth/cached-session";
import { db } from "@/lib/db/connection";
import { userHasPassword } from "@/lib/db/queries/auth";
import { oauthClients, oauthConsents } from "@/lib/db/schema/oauth-provider";

import { ConnectedAppsCard } from "./_components/connected-apps-card";
import { DeleteAccountSection } from "./_components/delete-account-section";
import { EmailSection } from "./_components/email-section";
import { OpaqueChangePasswordSection } from "./_components/opaque-change-password-section";
import { PasskeyManagementSection } from "./_components/passkey-management-section";
import { RecoverySetupSection } from "./_components/recovery-setup-section";
import {
  ConnectedAccountsCard,
  SessionsCard,
} from "./_components/security-cards";
import { SetPasswordSection } from "./_components/set-password-section";
import { TwoFactorCard } from "./_components/two-factor-card";
import { UserDataSection } from "./_components/user-data-section";
import { WalletBindingSection } from "./_components/wallet-binding-section";

type SettingsTab = "security" | "recovery" | "profile" | "account";

function parseDefaultTab(tab?: string): SettingsTab {
  if (tab === "recovery" || tab === "profile" || tab === "account") {
    return tab;
  }
  return "security";
}

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ tab?: string; walletRisk?: string }>;
}>) {
  const session = await getCachedSession(await headers());
  const params = await searchParams;
  const defaultTab = parseDefaultTab(params.tab);
  const showWalletRiskNotice = params.walletRisk === "1";

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
      <PageHeader
        description="Manage your account settings, security, and recovery options"
        title="Settings"
      />

      {showWalletRiskNotice && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Wallet access can be fragile</AlertTitle>
          <AlertDescription>
            Wallet signatures may change across firmware or wallet app changes.
            Add a backup passkey or enable guardian recovery now.
          </AlertDescription>
        </Alert>
      )}

      <Tabs className="w-full" defaultValue={defaultTab}>
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
          {hasPassword ? (
            <OpaqueChangePasswordSection />
          ) : (
            <SetPasswordSection />
          )}
          <WalletBindingSection />
        </TabsContent>

        {/* RECOVERY TAB - Backup access options */}
        <TabsContent className="mt-6 space-y-6" value="recovery">
          <SectionHeader
            description="Set up backup options in case you lose access to your account"
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
          <EmailSection />
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

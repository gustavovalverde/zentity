"use client";

import {
  ArrowLeft01Icon,
  Globe02Icon,
  SecurityCheckIcon,
  SecurityLockIcon,
  Shield01Icon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { AidDashboard } from "@/components/aid/aid-dashboard";
import { AidHeader } from "@/components/aid/aid-header";
import { AssuranceBadges } from "@/components/shared/assurance-badges";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("aid");

export default function AidPage() {
  const {
    session,
    isPending,
    isAuthenticated,
    claims,
    isSteppedUp,
    handleSignIn,
    handleStepUp,
    handleSignOut,
  } = useOAuthFlow(scenario);

  const [dcrReady, setDcrReady] = useState(false);
  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        data-theme="aid"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="font-medium text-muted-foreground">
            Verifying credentials...
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen flex-col bg-background font-sans selection:bg-primary/10"
        data-theme="aid"
      >
        <AidHeader onSignOut={Function.prototype as () => void} />

        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
          <div className="absolute top-6 right-6">
            <Link
              className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
              href="/"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              Demos
            </Link>
          </div>

          <div className="relative z-10 w-full max-w-md space-y-8 text-center">
            <div className="mx-auto mb-4 flex size-24 items-center justify-center rounded-full bg-card shadow-primary/5 shadow-xl">
              <HugeiconsIcon
                className="text-primary"
                icon={Globe02Icon}
                size={48}
              />
            </div>

            <div className="space-y-4">
              <h1 className="font-bold text-3xl text-foreground tracking-tight md:text-4xl">
                Aid Distribution Portal
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Verify your identity to access humanitarian assistance.
                Centralized databases endanger vulnerable populations, so only
                your name and nationality are shared. No biometrics are
                retained.
              </p>
            </div>

            <div className="space-y-6 pt-4">
              <DcrRegistration
                clientName={scenario.dcr.clientName}
                defaultScopes={scenario.dcr.defaultScopes}
                onRegistered={handleDcrRegistered}
                providerId={scenario.id}
              />
              <Button
                className="h-14 w-full gap-3 bg-primary font-medium text-lg shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl"
                disabled={!dcrReady}
                onClick={handleSignIn}
                size="lg"
              >
                <HugeiconsIcon icon={UserCircle02Icon} size={20} />
                Verify Identity
              </Button>

              <div className="grid grid-cols-1 gap-3 text-muted-foreground text-xs sm:grid-cols-2">
                {[
                  {
                    icon: SecurityCheckIcon,
                    text: "No biometric data retained",
                  },
                  {
                    icon: SecurityLockIcon,
                    text: "Only name and nationality shared",
                  },
                  {
                    icon: Shield01Icon,
                    text: "GDPR Art. 9 compliant",
                  },
                  {
                    icon: Globe02Icon,
                    text: "No centralized identity database",
                  },
                ].map((item) => (
                  <div
                    className="flex items-center gap-2 rounded-lg border bg-card p-3 shadow-sm"
                    key={item.text}
                  >
                    <HugeiconsIcon
                      className="shrink-0 text-success"
                      icon={item.icon}
                      size={16}
                    />
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background" data-theme="aid">
      <AidHeader
        isVerified={isSteppedUp}
        onSignOut={handleSignOut}
        userEmail={session?.user.email}
      />

      <main className="container mx-auto flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="space-y-2">
            <h1 className="font-bold text-2xl tracking-tight">
              Beneficiary Dashboard
            </h1>
            <p className="text-muted-foreground">
              Manage your aid distribution and verify status.
            </p>
            <AssuranceBadges claims={claims} />
          </div>

          <AidDashboard
            claims={claims}
            isSteppedUp={isSteppedUp}
            onStepUp={handleStepUp}
          />
        </div>
      </main>
    </div>
  );
}

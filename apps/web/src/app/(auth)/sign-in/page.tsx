"use client";

import { AuthView } from "@daveyplate/better-auth-ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { OpaqueSignInForm } from "@/components/auth/opaque-sign-in-form";
import { PasskeySignInForm } from "@/components/auth/passkey-sign-in-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/auth-client";

type SignInTab = "passkey" | "other";

/**
 * Returns a human-readable label for the last used login method.
 */
function getLastUsedLabel(method: string | null): string | null {
  if (!method) {
    return null;
  }
  if (method === "passkey") {
    return "Passkey";
  }
  if (method === "opaque") {
    return "Password";
  }
  if (method === "credential" || method === "email") {
    return "Email/Password";
  }
  if (method === "magic-link" || method === "magiclink") {
    return "Magic Link";
  }
  return method;
}

export default function SignInPage() {
  const [activeTab, setActiveTab] = useState<SignInTab>("passkey");
  const [lastUsedMethod, setLastUsedMethod] = useState<string | null>(null);

  useEffect(() => {
    const lastUsed = authClient.getLastUsedLoginMethod?.() ?? null;
    setLastUsedMethod(lastUsed);
    // Default to passkey tab, but switch to "other" if last method wasn't passkey
    if (lastUsed && lastUsed !== "passkey") {
      setActiveTab("other");
    }
  }, []);

  const lastUsedLabel = getLastUsedLabel(lastUsedMethod);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to your Zentity account</CardDescription>
      </CardHeader>
      <CardContent>
        {lastUsedLabel ? (
          <p className="mb-3 text-center text-muted-foreground text-xs">
            Last used:{" "}
            <span className="font-medium text-foreground">{lastUsedLabel}</span>
          </p>
        ) : null}
        <Tabs
          className="w-full"
          onValueChange={(value) => setActiveTab(value as SignInTab)}
          value={activeTab}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="passkey">Passkey</TabsTrigger>
            <TabsTrigger value="other">Password / OAuth</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="passkey">
            {/* Custom passkey form with PRF support for FHE key derivation */}
            <PasskeySignInForm />
          </TabsContent>
          <TabsContent className="mt-4" value="other">
            <div className="space-y-6">
              <OpaqueSignInForm />
              <div className="flex items-center gap-3 text-muted-foreground text-xs">
                <Separator className="flex-1" />
                <span>Or continue with</span>
                <Separator className="flex-1" />
              </div>
              {/* AuthView with hidden card (transparent wrapper) - keeps magic link + social */}
              <AuthView
                classNames={{
                  base: "border-0 bg-transparent p-0 shadow-none",
                  header: "hidden",
                  footer: "hidden",
                }}
                view="SIGN_IN"
              />
            </div>
          </TabsContent>
        </Tabs>
        <div className="mt-6 text-center text-muted-foreground text-sm">
          Need an account?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/sign-up?fresh=1"
          >
            Sign Up
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

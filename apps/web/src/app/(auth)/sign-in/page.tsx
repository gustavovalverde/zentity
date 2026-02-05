"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { OpaqueSignInForm } from "@/components/auth/opaque-sign-in-form";
import { PasskeySignInForm } from "@/components/auth/passkey-sign-in-form";
import { SocialLoginButtons } from "@/components/auth/social-login-buttons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lazy load wallet form - wagmi + @reown/appkit are heavy dependencies.
 * Only loaded when user clicks the "Wallet" tab.
 */
const WalletSignInForm = dynamic(
  () =>
    import("@/components/auth/wallet-sign-in-form").then(
      (m) => m.WalletSignInForm
    ),
  {
    loading: () => (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    ),
  }
);

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

type SignInTab = "passkey" | "wallet" | "other";

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
  if (method === "wallet" || method === "siwe") {
    return "Wallet";
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
  const tabsId = useId();
  const [activeTab, setActiveTab] = useState<SignInTab>("passkey");
  const [lastUsedMethod, setLastUsedMethod] = useState<string | null>(null);

  useEffect(() => {
    const lastUsed = authClient.getLastUsedLoginMethod?.() ?? null;
    setLastUsedMethod(lastUsed);
    // Default to passkey tab, but switch based on last used method
    if (lastUsed === "wallet" || lastUsed === "siwe") {
      setActiveTab("wallet");
    } else if (lastUsed && lastUsed !== "passkey") {
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
          id={tabsId}
          onValueChange={(value) => setActiveTab(value as SignInTab)}
          value={activeTab}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="passkey">Passkey</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            <TabsTrigger value="other">More</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="passkey">
            <PasskeySignInForm />
          </TabsContent>
          <TabsContent className="mt-4" value="wallet">
            <WalletSignInForm />
          </TabsContent>
          <TabsContent className="mt-4" value="other">
            <div className="space-y-6">
              <OpaqueSignInForm />
              <div className="flex items-center gap-3 text-muted-foreground text-xs">
                <Separator className="flex-1" />
                <span>Or continue with</span>
                <Separator className="flex-1" />
              </div>
              <SocialLoginButtons />
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

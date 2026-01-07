"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MagicLinkForm } from "@/components/auth/magic-link-form";
import { PasskeySignInForm } from "@/components/auth/passkey-sign-in-form";
import { SignInForm } from "@/components/auth/sign-in-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/auth-client";

type SignInTab = "passkey" | "magic-link" | "password";

const resolveLastUsedInfo = (
  method: string | null
): { tab: SignInTab; label: string } | null => {
  if (method === "passkey") {
    return { tab: "passkey", label: "Passkey" };
  }
  if (method === "email" || method === "credential") {
    return { tab: "password", label: "Password" };
  }
  if (method === "magic-link" || method === "magiclink") {
    return { tab: "magic-link", label: "Magic Link" };
  }
  return null;
};

const resolveDefaultTab = (method: string | null): SignInTab =>
  resolveLastUsedInfo(method)?.tab ?? "passkey";

export default function SignInPage() {
  const [activeTab, setActiveTab] = useState<SignInTab>("passkey");
  const [lastUsedMethod, setLastUsedMethod] = useState<string | null>(null);
  const lastUsedInfo = resolveLastUsedInfo(lastUsedMethod);

  useEffect(() => {
    const lastUsed = authClient.getLastUsedLoginMethod?.() ?? null;
    setLastUsedMethod(lastUsed);
    setActiveTab(resolveDefaultTab(lastUsed));
  }, []);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to your Zentity account</CardDescription>
      </CardHeader>
      <CardContent>
        {lastUsedInfo ? (
          <p className="mb-3 text-center text-muted-foreground text-xs">
            Last used:{" "}
            <span className="font-medium text-foreground">
              {lastUsedInfo.label}
            </span>
          </p>
        ) : null}
        <Tabs
          className="w-full"
          onValueChange={(value) => setActiveTab(value as SignInTab)}
          value={activeTab}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="passkey">Passkey</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="passkey">
            <PasskeySignInForm />
          </TabsContent>
          <TabsContent className="mt-4" value="magic-link">
            <MagicLinkForm />
          </TabsContent>
          <TabsContent className="mt-4" value="password">
            <SignInForm />
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

import Link from "next/link";

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

export default function SignInPage() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to your Zentity account</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs className="w-full" defaultValue="passkey">
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

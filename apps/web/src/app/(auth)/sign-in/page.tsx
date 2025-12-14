import Link from "next/link";
import { MagicLinkForm } from "@/components/auth/magic-link-form";
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
        <Tabs defaultValue="password" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
          </TabsList>
          <TabsContent value="password" className="mt-4">
            <SignInForm />
          </TabsContent>
          <TabsContent value="magic-link" className="mt-4">
            <MagicLinkForm />
          </TabsContent>
        </Tabs>
        <div className="mt-6 text-center text-sm text-muted-foreground">
          Need an account?{" "}
          <Link
            href="/sign-up?fresh=1"
            className="font-medium text-primary hover:underline"
          >
            Sign Up
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

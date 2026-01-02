import { AlertCircle } from "lucide-react";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Invalid Reset Link</CardTitle>
          <CardDescription>
            This password reset link is invalid or has expired
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>
              Password reset links are valid for 1 hour. Please request a new
              one.
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/forgot-password">Request New Link</Link>
            </Button>
            <Button asChild className="w-full" variant="ghost">
              <Link href="/sign-in">Back to Sign In</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Reset Password</CardTitle>
        <CardDescription>Enter your new password below</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
        <div className="mt-6 text-center text-muted-foreground text-sm">
          Remember your password?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/sign-in"
          >
            Sign In
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

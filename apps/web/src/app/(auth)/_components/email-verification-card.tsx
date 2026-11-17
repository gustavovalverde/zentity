"use client";

import { useAuth } from "@better-auth-ui/react";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { withPasskeyConfirmation } from "@/lib/auth/passkey/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

/** Seconds the resend button stays disabled after a link is sent. */
const RESEND_COOLDOWN_SECONDS = 60;

export function EmailVerificationCard({
  email,
}: Readonly<{ email: string | null }>) {
  const { redirectTo } = useAuth();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0 || !email) {
      return;
    }
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown, email]);

  const resend = useMutation({
    mutationFn: async (address: string) => {
      const result = await withPasskeyConfirmation(() =>
        authClient.sendVerificationEmail({
          email: address,
          callbackURL: getSafeRedirectPath(redirectTo, "/dashboard"),
        })
      );
      if (result.error) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: () => {
      toast.success("Verification email sent", {
        description: "Check your inbox for a verification link.",
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    },
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheck className="h-8 w-8" />
        </div>
        <CardTitle className="text-2xl">Verify your email</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a verification link to <strong>{email}</strong>
            </>
          ) : (
            "Check your email for a verification link"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {resend.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {resend.error.message ||
                "Couldn't send the verification email. Try again."}
            </AlertDescription>
          </Alert>
        ) : null}

        {email ? (
          <Button
            className="w-full"
            disabled={cooldown > 0 || resend.isPending}
            onClick={() => resend.mutate(email)}
            variant="outline"
          >
            {resend.isPending ? (
              <Spinner aria-hidden="true" className="mr-2" />
            ) : null}
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          </Button>
        ) : null}

        <p className="text-center text-muted-foreground text-sm">
          Already verified?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/sign-in"
          >
            Sign In
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

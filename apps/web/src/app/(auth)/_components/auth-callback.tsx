"use client";

import { getSafeRedirectTo } from "@better-auth-ui/core";
import { useAuth, useSession } from "@better-auth-ui/react";
import { useEffect, useRef } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * Sends the browser on once the session is known: a signed-in user to the
 * requested same-origin page, a signed-out user to sign in first.
 */
export function AuthCallback() {
  const { authClient, basePaths, redirectTo, viewPaths } = useAuth();
  const { data: session, isPending } = useSession(authClient);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (isPending || hasRedirected.current) {
      return;
    }
    hasRedirected.current = true;

    const target = getSafeRedirectTo(redirectTo, globalThis.location.origin);
    // A full page load, so server components read the new session cookie.
    globalThis.location.replace(
      session
        ? target
        : `${basePaths.auth}/${viewPaths.auth.signIn}?callbackURL=${encodeURIComponent(target)}`
    );
  }, [basePaths.auth, isPending, redirectTo, session, viewPaths.auth.signIn]);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

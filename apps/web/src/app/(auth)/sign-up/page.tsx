import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignUpWizard } from "@/components/sign-up/sign-up-wizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCachedSession } from "@/lib/auth/cached-session";
import { hasCompletedSignUp } from "@/lib/db/queries/identity";
import { loadWizardState } from "@/lib/db/sign-up-session";

interface SignUpPageProps {
  searchParams: Promise<{ fresh?: string }>;
}

export default async function SignUpPage({
  searchParams,
}: Readonly<SignUpPageProps>) {
  const { fresh } = await searchParams;

  // fresh=1 bypasses all checks - allows starting a new sign-up flow
  if (fresh !== "1") {
    // Primary check: identity bundle (authoritative source)
    const headersObj = await headers();
    const session = await getCachedSession(headersObj);

    if (session?.user?.id) {
      const completed = await hasCompletedSignUp(session.user.id);
      if (completed) {
        redirect("/dashboard");
      }
    }

    // Secondary check: wizard state cookie (backwards compatibility)
    const { state } = await loadWizardState();
    if (state?.keysSecured) {
      redirect("/dashboard");
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create Account</CardTitle>
        <CardDescription>
          Start your privacy-first verification journey
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpWizard forceReset={fresh === "1"} />
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadWizardState } from "@/lib/db/onboarding-session";

interface SignUpPageProps {
  searchParams: Promise<{ fresh?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { fresh } = await searchParams;

  // Server-side check: redirect to dashboard if user already completed onboarding
  // This prevents the flash where email step shows before client-side hydration kicks in
  if (fresh !== "1") {
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
        <OnboardingWizard forceReset={fresh === "1"} />
        <div className="mt-6 text-center text-muted-foreground text-sm">
          Already have an account?{" "}
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

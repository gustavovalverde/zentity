import Link from "next/link";

import { Wizard } from "@/components/onboarding/wizard";
import { WizardProvider } from "@/components/onboarding/wizard-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SignUpPageProps {
  searchParams: Promise<{ fresh?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { fresh } = await searchParams;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create Account</CardTitle>
        <CardDescription>
          Start your privacy-first verification journey
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WizardProvider forceReset={fresh === "1"}>
          <Wizard />
        </WizardProvider>
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

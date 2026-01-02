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
  searchParams: Promise<{ rp_flow?: string; fresh?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { rp_flow, fresh } = await searchParams;

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
        {rp_flow ? (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
            After you finish, you&apos;ll be returned to the requesting service.
          </div>
        ) : null}
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

import Link from "next/link";
import { Wizard, WizardProvider } from "@/components/onboarding";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create Account</CardTitle>
        <CardDescription>
          Start your privacy-first verification journey
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WizardProvider>
          <Wizard />
        </WizardProvider>
        <div className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-primary hover:underline"
          >
            Sign In
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

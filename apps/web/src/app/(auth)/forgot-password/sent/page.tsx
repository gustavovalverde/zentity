import { Mail } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function ForgotPasswordSentPage({ searchParams }: PageProps) {
  const { email } = await searchParams;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-2xl">Check Your Email</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a password reset link to{" "}
              <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            "We sent a password reset link to your email"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          <p>The link will expire in 1 hour.</p>
          <p className="mt-2">
            If you don&apos;t see the email, check your spam folder.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="outline" asChild className="w-full">
            <Link href="/forgot-password">Try a different email</Link>
          </Button>
          <Button variant="ghost" asChild className="w-full">
            <Link href="/sign-in">Back to Sign In</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

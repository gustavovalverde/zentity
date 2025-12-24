import { CheckCircle2, Mail } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface MagicLinkSentPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function MagicLinkSentPage({
  searchParams,
}: MagicLinkSentPageProps) {
  const params = await searchParams;
  const email = params.email || "your email";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
          <Mail className="h-8 w-8" />
        </div>
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription>
          We sent a magic link to <strong>{email}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
            <div>
              <p className="text-sm font-medium">
                Click the link in your email
              </p>
              <p className="text-xs text-muted-foreground">
                The link will sign you in automatically
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
            <div>
              <p className="text-sm font-medium">Link expires in 5 minutes</p>
              <p className="text-xs text-muted-foreground">
                Request a new link if it expires
              </p>
            </div>
          </div>
        </div>

        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Didn't receive the email? Check your spam folder or{" "}
            <Link href="/sign-in" className="text-primary hover:underline">
              try again
            </Link>
          </p>

          <Button variant="outline" asChild className="w-full">
            <Link href="/sign-in">Back to Sign In</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

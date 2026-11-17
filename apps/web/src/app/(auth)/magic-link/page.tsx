import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { MagicLinkForm } from "../_components/magic-link-form";

export default function MagicLinkPage() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign In with Email</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a magic link
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MagicLinkForm />
        <div className="mt-6 text-center text-muted-foreground text-sm">
          Prefer another method?{" "}
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

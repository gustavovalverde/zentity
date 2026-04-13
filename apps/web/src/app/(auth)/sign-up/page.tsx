import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCachedSession } from "@/lib/auth/session";
import { hasCompletedSignUp } from "@/lib/db/queries/identity";

import { SignUpForm } from "./_components/sign-up-form";

export default async function SignUpPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);

  if (session?.user?.id) {
    const completed = await hasCompletedSignUp(session.user.id);
    if (completed) {
      redirect("/dashboard");
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Create Account</CardTitle>
        <CardDescription>Create your account to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm />
      </CardContent>
    </Card>
  );
}

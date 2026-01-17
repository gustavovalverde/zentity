import { getSafeRedirectPath } from "@/lib/utils/navigation";

import { SignOutClient } from "./sign-out-client";

interface SignOutPageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function SignOutPage({
  searchParams,
}: Readonly<SignOutPageProps>) {
  const { redirectTo } = await searchParams;
  const safeRedirectTo = getSafeRedirectPath(redirectTo, "/");

  return <SignOutClient redirectTo={safeRedirectTo} />;
}

import { getSafeRedirectPath } from "@/lib/utils/navigation";

import { VerifyTwoFactorClient } from "./verify-2fa-client";

interface VerifyTwoFactorPageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function VerifyTwoFactorPage({
  searchParams,
}: VerifyTwoFactorPageProps) {
  const { redirectTo } = await searchParams;
  const safeRedirectTo = getSafeRedirectPath(redirectTo, "/dashboard");

  return <VerifyTwoFactorClient redirectTo={safeRedirectTo} />;
}

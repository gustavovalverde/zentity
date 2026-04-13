import { getSafeRedirectPath } from "@/lib/auth/redirect";

import { VerifyTwoFactorClient } from "./verify-client";

interface VerifyTwoFactorPageProps {
  searchParams: Promise<{ redirectTo?: string; totpURI?: string }>;
}

export default async function VerifyTwoFactorPage({
  searchParams,
}: Readonly<VerifyTwoFactorPageProps>) {
  const { redirectTo, totpURI } = await searchParams;
  const isSetup = Boolean(totpURI);
  const safeRedirectTo = getSafeRedirectPath(
    redirectTo,
    isSetup ? "/two-factor/backup-codes" : "/dashboard"
  );

  return (
    <VerifyTwoFactorClient redirectTo={safeRedirectTo} totpUri={totpURI} />
  );
}

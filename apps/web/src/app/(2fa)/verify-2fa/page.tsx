import { getSafeRedirectPath } from "@/lib/utils/navigation";

import { VerifyTwoFactorClient } from "./verify-2fa-client";

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
    isSetup ? "/backup-codes" : "/dashboard"
  );

  return (
    <VerifyTwoFactorClient redirectTo={safeRedirectTo} totpUri={totpURI} />
  );
}

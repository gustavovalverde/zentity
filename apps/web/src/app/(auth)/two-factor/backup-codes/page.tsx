import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCachedSession } from "@/lib/auth/session";

import { BackupCodesClient } from "./_components/backup-codes-client";

export default async function BackupCodesPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);

  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  if (!(session.user as Record<string, unknown>).twoFactorEnabled) {
    redirect("/dashboard/settings");
  }

  return <BackupCodesClient />;
}

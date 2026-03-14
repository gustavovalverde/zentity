import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCachedSession } from "@/lib/auth/cached-session";

import { BackupCodesClient } from "./backup-codes-client";

export default async function BackupCodesPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);

  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  if (!session.user.twoFactorEnabled) {
    redirect("/dashboard/settings");
  }

  return <BackupCodesClient />;
}

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

import { VaultRecovery } from "../_components/vault-recovery";

export default async function RecoverVaultPage() {
  const session = await getCachedSession(await headers());
  if (!session) {
    redirect("/sign-in?callbackURL=/recovery/vault");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Encrypted Data</CardTitle>
        <CardDescription>
          Keep your encryption keys and verified profile open with the sign-in
          methods you use now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VaultRecovery />
      </CardContent>
    </Card>
  );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/chrome/page-header";
import { TierBadge } from "@/components/tier-badge";
import { env } from "@/env";
import { getSecurityPostureForSession } from "@/lib/assurance/posture";
import { getCachedSession } from "@/lib/auth/session";
import {
  getPrimaryWalletAddress,
  userHasPassword,
} from "@/lib/db/queries/auth";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import {
  computeInitialStep,
  type VerificationStep,
} from "@/lib/identity/verification/steps";
import { buildCountryDocumentList } from "@/lib/identity/verification/zkpassport-registry";

import { VerificationFlow } from "./_components/verification-flow";

const PAGE_TITLES: Record<
  VerificationStep,
  { title: string; description: string }
> = {
  enrollment: {
    title: "Verify Your Identity",
    description: "Set up encryption keys before starting verification",
  },
  method: {
    title: "Verify Your Identity",
    description:
      "Scan your document or use your document's NFC chip to verify and unlock features",
  },
  document: {
    title: "Complete Verification",
    description: "Upload your document to continue verification",
  },
  liveness: {
    title: "Complete Verification",
    description: "Complete liveness and face match to finish verification",
  },
  "passport-chip": {
    title: "Complete Verification",
    description:
      "Read your passport's NFC chip for the highest level of verification",
  },
};

export default async function VerifyPage() {
  const headersObj = await headers();
  const session = await getCachedSession(headersObj);
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/sign-in");
  }

  const [posture, bundle, hasPassword, wallet, countries] = await Promise.all([
    getSecurityPostureForSession(userId, session),
    getIdentityBundleByUserId(userId),
    userHasPassword(userId),
    getPrimaryWalletAddress(userId),
    buildCountryDocumentList(),
  ]);
  const assurance = posture.assurance;
  const hasEnrollment = Boolean(bundle?.fheKeyId);
  const zkPassportEnabled = env.NEXT_PUBLIC_ZKPASSPORT_ENABLED;

  const result = computeInitialStep(assurance, {
    hasEnrollment,
    zkPassportEnabled,
  });

  if (!result) {
    redirect("/dashboard");
  }

  const pageMeta = PAGE_TITLES[result.step];
  const showReVerifyHeader =
    result.context.missingProfileSecret && assurance.tier >= 2;

  return (
    <div className="space-y-6">
      <PageHeader
        description={
          showReVerifyHeader
            ? "Your identity data was not saved during verification. Re-verify to enable identity sharing with applications."
            : pageMeta.description
        }
        title={showReVerifyHeader ? "Re-verify Identity" : pageMeta.title}
      >
        <TierBadge size="md" tier={assurance.tier} />
      </PageHeader>

      <VerificationFlow
        context={result.context}
        countries={countries}
        hasPasskeys={posture.capabilities.hasPasskeys}
        hasPassword={hasPassword}
        initialStep={result.step}
        wallet={wallet}
        zkPassportEnabled={zkPassportEnabled}
      />
    </div>
  );
}

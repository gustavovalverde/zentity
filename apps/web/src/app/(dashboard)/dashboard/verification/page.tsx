import { headers } from "next/headers";
import { Suspense } from "react";

import { getCachedSession } from "@/lib/auth/cached-session";

import { VerificationContent } from "./_components/verification-content";
import { VerificationContentSkeleton } from "./_components/verification-skeleton";

export default async function VerificationPage() {
  const session = await getCachedSession(await headers());

  const userId = session?.user?.id;

  return (
    <div className="space-y-6">
      {/* INSTANT - Header */}
      <div>
        <h1 className="font-bold text-2xl">Verification Status</h1>
        <p className="text-muted-foreground">
          Your identity verification details and cryptographic proofs
        </p>
      </div>

      {/* STREAMING - All verification content */}
      <Suspense fallback={<VerificationContentSkeleton />}>
        <VerificationContent userId={userId} />
      </Suspense>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

import { OffChainAttestationSkeleton } from "./_components/off-chain-attestation-skeleton";

export default function AttestationLoading() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-2 h-5 w-80" />
        </div>
      </div>

      {/* Off-Chain Attestation Card */}
      <OffChainAttestationSkeleton />

      {/* On-Chain Attestation skeleton */}
      <div className="space-y-4 rounded-lg border p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>

      {/* View Identity Data skeleton */}
      <div className="rounded-lg border p-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
    </div>
  );
}

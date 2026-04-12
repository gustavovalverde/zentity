import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <div className="flex items-baseline gap-1">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="inline-block h-6 w-24 align-baseline" />
        </div>
        <Skeleton className="mt-1 h-5 w-64" />
      </div>

      {/* Main Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Identity Verification Card */}
        <div className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* On-Chain Attestation Card */}
        <div className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* Quick Actions Card */}
        <div className="space-y-4 rounded-lg border p-6 md:col-span-2">
          <Skeleton className="h-4 w-24" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-9 rounded-md" />
            <Skeleton className="h-9 rounded-md" />
            <Skeleton className="h-9 rounded-md" />
            <Skeleton className="h-9 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

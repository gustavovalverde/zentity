import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function OffChainAttestationSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Off-Chain Attestation</CardTitle>
        <CardDescription>
          Latest identity bundle, document, proofs, and encrypted attributes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div>
            <Skeleton className="mb-1 h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium text-sm">Proofs</p>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium text-sm">Signed Claims</p>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>

        <div>
          <p className="mb-2 font-medium text-sm">Encrypted Attributes</p>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

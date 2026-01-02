import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRpFlow } from "@/lib/auth/rp-flow";

interface PageProps {
  searchParams: Promise<{ flow?: string }>;
}

export default async function RpVerifyPage({ searchParams }: PageProps) {
  const { flow } = await searchParams;
  if (!flow) {
    notFound();
  }

  const flowData = await getRpFlow(flow);
  if (!flowData) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Verify with Zentity</CardTitle>
          <p className="text-muted-foreground text-sm">
            This verification request will be completed in Zentity and then
            you&apos;ll be returned to the requesting service.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">Client</p>
            <p className="break-all font-mono">{flowData.clientId}</p>
          </div>

          <div className="flex gap-3">
            <Button asChild className="flex-1">
              <Link href={`/sign-up?rp_flow=${encodeURIComponent(flow)}`}>
                Continue
              </Link>
            </Button>
            <Button asChild className="flex-1" variant="outline">
              <Link href="/">Cancel</Link>
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            Tip: If you close this page, the request will expire in ~2 minutes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

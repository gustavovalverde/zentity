import { Code, Shield } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { AgeProofDemo } from "@/components/dashboard/age-proof-demo";
import { FheVerificationDemo } from "@/components/dashboard/fhe-verification-demo";
import { NameVerificationDemo } from "@/components/dashboard/name-verification-demo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/auth";
import { getUserAgeProofFull } from "@/lib/db/queries/crypto";
import { getVerificationStatus } from "@/lib/db/queries/identity";

export default async function RPIntegrationPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;
  const ageProof = userId ? await getUserAgeProofFull(userId) : null;
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;

  const hasProof = verificationStatus?.verified || ageProof?.isOver18;

  const checks = {
    document: verificationStatus?.checks.document ?? false,
    liveness: verificationStatus?.checks.liveness ?? false,
    ageProof: Boolean(
      verificationStatus?.checks.ageProof || ageProof?.isOver18
    ),
    docValidityProof: verificationStatus?.checks.docValidityProof ?? false,
    nationalityProof: verificationStatus?.checks.nationalityProof ?? false,
    faceMatchProof: verificationStatus?.checks.faceMatchProof ?? false,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">RP Integration</h1>
        <p className="text-muted-foreground">
          Test the API endpoints that allow third parties to verify identity
          claims
        </p>
      </div>

      <Alert variant="info">
        <Code className="h-4 w-4" />
        <AlertDescription>
          <strong>Relying Party Demo</strong> - Test the API endpoints that
          allow third parties to verify identity claims without accessing any
          PII.
        </AlertDescription>
      </Alert>

      {/* Demo Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <NameVerificationDemo />
        <AgeProofDemo />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <FheVerificationDemo
          birthYearOffsetCiphertext={
            ageProof?.birthYearOffsetCiphertext ?? undefined
          }
          fheKeyId={ageProof?.fheKeyId ?? undefined}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">RP Exchange API</CardTitle>
            <CardDescription>
              Exchange a one-time code for verification flags
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <code className="text-xs">
                <span className="text-success">POST</span>{" "}
                <span className="text-info">/api/rp/exchange</span>
              </code>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
              <pre className="whitespace-pre-wrap">
                {`{
  "success": true,
  "verified": ${hasProof},
  "level": "${hasProof ? "basic" : "none"}",
  "checks": {
    "document": ${checks.document},
    "liveness": ${checks.liveness},
    "ageProof": ${checks.ageProof},
    "docValidityProof": ${checks.docValidityProof},
    "nationalityProof": ${checks.nationalityProof},
    "faceMatchProof": ${checks.faceMatchProof}
  }
}`}
              </pre>
            </div>

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No PII is included in the response. Only verification flags and
                status levels are returned.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      {/* Integration Code Example */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integration Code</CardTitle>
          <CardDescription>
            Example code for relying parties to verify users
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs">
            <pre>{`// 1) Redirect the user into Zentity's verification flow
const authorizeUrl = new URL('https://zentity.example.com/api/rp/authorize');
authorizeUrl.searchParams.set('client_id', '<client_uuid>');
authorizeUrl.searchParams.set('redirect_uri', 'https://rp.example.com/callback');
authorizeUrl.searchParams.set('state', '<opaque_state>');
window.location.assign(authorizeUrl.toString());

// 2) On your server, exchange the one-time code for verification flags
const exchange = await fetch('https://zentity.example.com/api/rp/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: '<uuid>', client_id: '<client_uuid>' })
});
const { verified, level, checks } = await exchange.json();
// Returns: { verified, level, checks } - NO PII REVEALED`}</pre>
          </div>
          <div className="mt-4">
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/dev">
                <Code className="mr-2 h-4 w-4" />
                Debug Tools
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

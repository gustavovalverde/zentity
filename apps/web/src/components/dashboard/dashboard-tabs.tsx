"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { VerificationProgress, type VerificationChecks } from "./verification-progress";
import { TransparencySection } from "./transparency-section";
import { NameVerificationDemo } from "./name-verification-demo";
import { VerificationActions } from "./verification-actions";
import { AgeProofDemo } from "./age-proof-demo";
import { FheVerificationDemo } from "./fhe-verification-demo";
import { User, Code, Shield, ArrowRight, ExternalLink, FileCheck, Globe, Calendar, CheckCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface DashboardTabsProps {
  checks: VerificationChecks;
  hasProof: boolean;
  identityData?: {
    documentHash?: string;
    nameCommitment?: string;
    dobCiphertext?: string;
    fheClientKeyId?: string;
    ageProof?: string;
    ageProofVerified?: boolean;
    // Document metadata (non-PII)
    documentType?: string;
    countryVerified?: string;
    verifiedAt?: string;
  };
}

export function DashboardTabs({ checks, hasProof, identityData }: DashboardTabsProps) {
  return (
    <Tabs defaultValue="user" className="space-y-6">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="user" className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span>Your Status</span>
        </TabsTrigger>
        <TabsTrigger value="relying-party" className="flex items-center gap-2">
          <Code className="h-4 w-4" />
          <span>RP Demo</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="user" className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <VerificationProgress checks={checks} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Privacy Score</CardTitle>
              <CardDescription>Your data exposure level</CardDescription>
            </CardHeader>
            <CardContent>
              {hasProof ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                        <path
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="text-muted"
                        />
                        <path
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray="100, 100"
                          className="text-green-500"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-green-600">
                        100%
                      </span>
                    </div>
                    <div>
                      <Badge className="bg-green-600 hover:bg-green-600">
                        Maximum Privacy
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        Zero PII stored on our servers
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your identity is verified using cryptographic proofs.
                    Only hashes and encrypted data are stored.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold text-yellow-600">0%</span>
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      Not Verified
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Complete verification to enable privacy-preserving identity proofs.
                  </p>
                  <Button asChild size="sm">
                    <Link href="/onboarding">
                      Start Verification
                      <ArrowRight className="ml-2 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Identity Summary - Show document metadata */}
        {hasProof && (identityData?.documentType || identityData?.countryVerified) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Identity Summary</CardTitle>
              <CardDescription>Verified document information (non-PII metadata)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {identityData?.documentType && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                      <FileCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Document Type</p>
                      <p className="font-medium">{identityData.documentType}</p>
                    </div>
                  </div>
                )}

                {identityData?.countryVerified && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
                      <Globe className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Country</p>
                      <p className="font-medium">{identityData.countryVerified === "DOM" ? "Dominican Republic" : identityData.countryVerified}</p>
                    </div>
                  </div>
                )}

                {identityData?.ageProofVerified && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900">
                      <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Age Verified</p>
                      <p className="font-medium">18+ Confirmed</p>
                    </div>
                  </div>
                )}

                {identityData?.verifiedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900">
                      <Calendar className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Verified On</p>
                      <p className="font-medium">{new Date(identityData.verifiedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {hasProof && (
          <TransparencySection
            documentHash={identityData?.documentHash}
            nameCommitment={identityData?.nameCommitment}
            dobCiphertext={identityData?.dobCiphertext}
            ageProof={identityData?.ageProof}
            ageProofVerified={identityData?.ageProofVerified}
          />
        )}

        {hasProof && <VerificationActions />}
      </TabsContent>

      <TabsContent value="relying-party" className="space-y-6">
        <Alert className="bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-800">
          <Code className="h-4 w-4 text-purple-600" />
          <AlertDescription>
            <strong>Relying Party Demo</strong> - Test the API endpoints that allow
            third parties to verify identity claims without accessing any PII.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 md:grid-cols-2">
          <NameVerificationDemo />
          <AgeProofDemo
            ageProof={identityData?.ageProof}
            ageProofVerified={identityData?.ageProofVerified}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <FheVerificationDemo
            dobCiphertext={identityData?.dobCiphertext}
            fheClientKeyId={identityData?.fheClientKeyId}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Verification Status API</CardTitle>
              <CardDescription>
                Check user verification level
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <code className="text-xs">
                  <span className="text-green-600">GET</span>{" "}
                  <span className="text-blue-600">/api/identity/status</span>
                </code>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                <pre className="whitespace-pre-wrap">
{`{
  "verified": ${hasProof},
  "level": "${hasProof ? "full" : "none"}",
  "checks": {
    "document": ${checks.document},
    "liveness": ${checks.liveness},
    "faceMatch": ${checks.faceMatch},
    "ageProof": ${checks.ageProof}
  }
}`}
                </pre>
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  No PII is included in the response. Only verification flags
                  and status levels are returned.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Integration Code</CardTitle>
            <CardDescription>
              Example code for relying parties to verify users
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs overflow-x-auto">
              <pre>{`// Check if user is verified
const status = await fetch('/api/identity/status', {
  headers: { 'Authorization': 'Bearer <user_token>' }
});
const { verified, level, checks } = await status.json();

// Verify a specific name claim (without seeing the actual name)
const result = await fetch('/api/identity/verify-name', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <user_token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ claimedName: 'Juan Perez' })
});
const { matches } = await result.json();
// Returns: { matches: true } - NO NAME REVEALED`}</pre>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/dev">
                  <Code className="mr-2 h-4 w-4" />
                  Developer Tools
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  API Docs
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

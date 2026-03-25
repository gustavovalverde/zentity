"use client";

import type { RouterOutputs } from "@/lib/trpc/types";

import {
  CalendarCheck,
  Check,
  Code,
  FileCheck,
  Fingerprint,
  Globe,
  Link as LinkIcon,
  ScanFace,
  Shield,
  UserCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { getChecks, getProofs } from "@/lib/privacy/zk/client";

type ChecksData = RouterOutputs["zk"]["getChecks"];
type ProofsData = RouterOutputs["zk"]["getProofs"];

const CHECK_TYPE_LABELS: Record<string, string> = {
  document: "Document Validity",
  age: "Age Verification",
  liveness: "Liveness Detection",
  face_match: "Face Match",
  nationality: "Nationality Membership",
  identity_binding: "Identity Binding",
  sybil_resistant: "Sybil Resistance",
};

const CHECK_TYPE_ICONS: Record<string, React.ReactNode> = {
  document: <FileCheck className="h-4 w-4 text-muted-foreground" />,
  age: <CalendarCheck className="h-4 w-4 text-muted-foreground" />,
  liveness: <ScanFace className="h-4 w-4 text-muted-foreground" />,
  face_match: <UserCheck className="h-4 w-4 text-muted-foreground" />,
  nationality: <Globe className="h-4 w-4 text-muted-foreground" />,
  identity_binding: <LinkIcon className="h-4 w-4 text-muted-foreground" />,
  sybil_resistant: <Fingerprint className="h-4 w-4 text-muted-foreground" />,
};

const SOURCE_LABELS: Record<string, string> = {
  zk_proof: "ZK Proof",
  signed_claim: "Server Attestation",
  chip_claim: "Passport Chip",
  commitment: "Cryptographic Commitment",
  nullifier: "Passport Nullifier",
  dedup_key: "Dedup Key",
};

function methodLabel(method: "ocr" | "nfc_chip" | null): string {
  if (method === "nfc_chip") {
    return "NFC Chip";
  }
  if (method === "ocr") {
    return "OCR";
  }
  return "None";
}

const PROOF_TYPE_LABELS: Record<string, string> = {
  age_verification: "Age Verification",
  doc_validity: "Document Validity",
  nationality_membership: "Nationality Membership",
  face_match: "Face Match",
  identity_binding: "Identity Binding",
};

export default function DevViewPage() {
  const [checksData, setChecksData] = useState<ChecksData | null>(null);
  const [proofsData, setProofsData] = useState<ProofsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [checks, proofs] = await Promise.all([getChecks(), getProofs()]);
        setChecksData(checks);
        setProofsData(proofs);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load verification data"
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" />
          <span>Loading verification data…</span>
        </div>
      </div>
    );
  }

  const checks = checksData?.checks ?? [];
  const proofs = proofsData?.proofs ?? [];

  if (error || (checks.length === 0 && proofs.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-bold text-2xl">Developer View</h1>
          <p className="text-muted-foreground">
            Technical details of your verification state
          </p>
        </div>
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Code />
                </EmptyMedia>
                <EmptyTitle>{error || "No Verification Data"}</EmptyTitle>
                <EmptyDescription>
                  Complete the verification process to generate proof data.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link href="/dashboard/verify">Complete Verification</Link>
                </Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      </div>
    );
  }

  const passedCount = checks.filter((c) => c.passed).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Developer View</h1>
        <p className="text-muted-foreground">
          Technical details of your verification state
        </p>
      </div>

      <Alert>
        <Code className="h-4 w-4" />
        <AlertDescription>
          This view shows the raw verification data stored for your account.
          Intended for developers and debugging purposes.
        </AlertDescription>
      </Alert>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Verification Summary</CardTitle>
          <CardDescription>
            Method:{" "}
            <Badge variant="outline">
              {methodLabel(checksData?.method ?? null)}
            </Badge>{" "}
            Level:{" "}
            <Badge variant={checksData?.verified ? "success" : "secondary"}>
              {checksData?.level ?? "none"}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Checks Passed</p>
              <p className="font-bold font-mono text-2xl">
                {passedCount} / {checks.length}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Total Proofs</p>
              <p className="font-bold font-mono text-2xl">{proofs.length}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Proof Systems</p>
              <p className="font-bold font-mono text-2xl">
                {new Set(proofs.map((p) => p.proofSystem)).size}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verification Checks */}
      <Card>
        <CardHeader>
          <CardTitle>Verification Checks ({checks.length})</CardTitle>
          <CardDescription>
            Materialized compliance checks with evidence sources
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {checks.map((check) => (
              <div
                className="flex items-center justify-between rounded-lg border p-3"
                key={check.checkType}
              >
                <div className="flex items-center gap-3">
                  {CHECK_TYPE_ICONS[check.checkType] ?? (
                    <Shield className="h-4 w-4" />
                  )}
                  <div>
                    <p className="font-medium text-sm">
                      {CHECK_TYPE_LABELS[check.checkType] ?? check.checkType}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Source: {SOURCE_LABELS[check.source] ?? check.source}
                    </p>
                  </div>
                </div>
                {check.passed ? (
                  <Badge variant="success">
                    <Check className="mr-1 h-3 w-3" /> Passed
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <X className="mr-1 h-3 w-3" /> Failed
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Proof Artifacts */}
      {proofs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Proof Artifacts ({proofs.length})</CardTitle>
            <CardDescription>
              Verified cryptographic proofs stored on-chain or in the database
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {proofs.map((proof) => (
                <div
                  className="flex items-center justify-between rounded-lg border p-3"
                  key={`${proof.proofType}-${proof.proofHash.slice(0, 8)}`}
                >
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-info" />
                    <div>
                      <p className="font-medium text-sm">
                        {PROOF_TYPE_LABELS[proof.proofType] ?? proof.proofType}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {proof.proofSystem} ·{" "}
                        {new Date(proof.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-muted-foreground text-xs">
                      {proof.proofHash.slice(0, 12)}…
                    </code>
                    <Badge variant="success">Verified</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

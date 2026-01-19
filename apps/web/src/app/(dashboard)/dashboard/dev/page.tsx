"use client";

import type { AgeProofFull } from "@/lib/privacy/crypto/age-proof-types";
import type { RouterOutputs } from "@/lib/trpc/types";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Code,
  Copy,
  Database,
  Key,
  Link as LinkIcon,
  Shield,
  Zap,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { getAllProofs, getUserProof } from "@/lib/privacy/crypto/crypto-client";
import { PROOF_TYPE_SPECS } from "@/lib/privacy/zk/proof-types";

type ProofData = RouterOutputs["crypto"]["getAllProofs"][number];

const PROOF_TYPE_LABELS: Record<string, string> = {
  age_verification: "Age Verification",
  doc_validity: "Document Validity",
  nationality_membership: "Nationality Membership",
  face_match: "Face Match",
  identity_binding: "Identity Binding",
};

const PROOF_TYPE_ICONS: Record<string, React.ReactNode> = {
  age_verification: <Shield className="h-5 w-5 text-info" />,
  doc_validity: <Shield className="h-5 w-5 text-success" />,
  nationality_membership: <Shield className="h-5 w-5 text-warning" />,
  face_match: <Shield className="h-5 w-5 text-primary" />,
  identity_binding: <LinkIcon className="h-5 w-5 text-violet-500" />,
};

function ProofCard({
  proof,
  copiedField,
  onCopy,
}: Readonly<{
  proof: ProofData;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}>) {
  const [proofOpen, setProofOpen] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);

  // Proofs are stored as base64-encoded binary (UltraHonk format), not JSON
  const proofDisplay = proof.proof ?? null;
  const signalsJson = proof.publicSignals
    ? JSON.stringify(proof.publicSignals, null, 2)
    : null;

  const spec =
    PROOF_TYPE_SPECS[proof.proofType as keyof typeof PROOF_TYPE_SPECS];
  const label = PROOF_TYPE_LABELS[proof.proofType] ?? proof.proofType;
  const icon = PROOF_TYPE_ICONS[proof.proofType] ?? (
    <Shield className="h-5 w-5" />
  );

  const formatMs = (ms: number | null | undefined): string => {
    if (ms === null || ms === undefined) {
      return "N/A";
    }
    return `${ms.toFixed(2)}ms`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
        <CardDescription>{spec?.description ?? "ZK Proof"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">UltraHonk</Badge>
          <Badge variant="secondary">BN254 Curve</Badge>
          {proof.noirVersion && (
            <Badge variant="outline">Noir {proof.noirVersion}</Badge>
          )}
          <Badge className="text-xs" variant="success">
            Verified
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">Generation Time</p>
            <p className="font-medium font-mono">
              {formatMs(proof.generationTimeMs)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">Created</p>
            <p className="font-medium font-mono text-sm">
              {new Date(proof.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {proofDisplay ? (
          <Collapsible onOpenChange={setProofOpen} open={proofOpen}>
            <CollapsibleTrigger asChild>
              <Button className="w-full justify-between" variant="outline">
                <span>View Raw Proof (Base64)</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${proofOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="relative">
                <Button
                  className="absolute top-2 right-2 z-10"
                  onClick={() => onCopy(proofDisplay, `proof-${proof.proofId}`)}
                  size="sm"
                  variant="ghost"
                >
                  {copiedField === `proof-${proof.proofId}` ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="max-h-64 overflow-auto break-all rounded-lg bg-muted p-4 font-mono text-xs">
                  {proofDisplay}
                </pre>
                <p className="mt-2 text-muted-foreground text-xs">
                  UltraHonk proof ({proofDisplay.length} chars base64)
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {signalsJson ? (
          <Collapsible onOpenChange={setSignalsOpen} open={signalsOpen}>
            <CollapsibleTrigger asChild>
              <Button className="w-full justify-between" variant="outline">
                <span>View Public Signals</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${signalsOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="relative">
                <Button
                  className="absolute top-2 right-2 z-10"
                  onClick={() =>
                    onCopy(signalsJson, `signals-${proof.proofId}`)
                  }
                  size="sm"
                  variant="ghost"
                >
                  {copiedField === `signals-${proof.proofId}` ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="max-h-48 overflow-auto break-all rounded-lg bg-muted p-4 font-mono text-xs">
                  {signalsJson}
                </pre>
                {spec && (
                  <div className="mt-2 text-muted-foreground text-xs">
                    Public input order: {spec.publicInputOrder.join(", ")}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="text-muted-foreground text-xs">
          Proof ID: <code className="text-xs">{proof.proofId}</code>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DevViewPage() {
  const [allProofs, setAllProofs] = useState<ProofData[]>([]);
  const [ageProofData, setAgeProofData] = useState<AgeProofFull | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProofs() {
      try {
        const [proofs, ageData] = await Promise.all([
          getAllProofs(),
          getUserProof(true),
        ]);
        setAllProofs(proofs);
        setAgeProofData(ageData);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load proof data"
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchProofs();
  }, []);

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatBytes = (bytes: number | null | undefined): string => {
    if (bytes === null || bytes === undefined) {
      return "N/A";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatMs = (ms: number | null | undefined): string => {
    if (ms === null || ms === undefined) {
      return "N/A";
    }
    return `${ms.toFixed(2)}ms`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner size="sm" />
          <span>Loading proof data…</span>
        </div>
      </div>
    );
  }

  if (error || allProofs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-bold text-2xl">Developer View</h1>
          <p className="text-muted-foreground">
            Technical details of your cryptographic proofs
          </p>
        </div>
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Code />
                </EmptyMedia>
                <EmptyTitle>{error || "No Proofs Found"}</EmptyTitle>
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

  // Group proofs by type, keeping only the latest of each type
  const proofsByType = new Map<string, ProofData>();
  for (const proof of allProofs) {
    if (!proofsByType.has(proof.proofType)) {
      proofsByType.set(proof.proofType, proof);
    }
  }
  const latestProofs = Array.from(proofsByType.values());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Developer View</h1>
        <p className="text-muted-foreground">
          Technical details of your cryptographic proofs
        </p>
      </div>

      <Alert>
        <Code className="h-4 w-4" />
        <AlertDescription>
          This view shows the raw cryptographic data stored for your account.
          This is intended for developers and debugging purposes.
        </AlertDescription>
      </Alert>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-warning" />
            Performance Metrics
          </CardTitle>
          <CardDescription>
            Timing data for cryptographic operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Total Proofs</p>
              <p className="truncate font-bold font-mono text-2xl">
                {latestProofs.length}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                Avg Generation Time
              </p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatMs(
                  latestProofs.reduce(
                    (sum, p) => sum + (p.generationTimeMs ?? 0),
                    0
                  ) / latestProofs.length
                )}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">FHE Encryption</p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatMs(ageProofData?.fheEncryptionTimeMs)}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Ciphertext Size</p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatBytes(ageProofData?.birthYearOffsetCiphertextBytes)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ZK Proof Cards */}
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">
          ZK Proofs ({latestProofs.length})
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {latestProofs.map((proof) => (
            <ProofCard
              copiedField={copiedField}
              key={proof.proofId}
              onCopy={copyToClipboard}
              proof={proof}
            />
          ))}
        </div>
      </div>

      {/* FHE Ciphertext */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-info" />
            FHE Ciphertext (TFHE)
          </CardTitle>
          <CardDescription>
            Encrypted date of birth for homomorphic computation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ageProofData?.birthYearOffsetCiphertextBytes ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">TFHE-rs</Badge>
                <Badge variant="secondary">Fully Homomorphic</Badge>
                <Badge variant="outline">
                  Key ID: {ageProofData.fheKeyId || "unregistered"}
                </Badge>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span>Ciphertext size</span>
                  <span>
                    {formatBytes(ageProofData.birthYearOffsetCiphertextBytes)}
                  </span>
                </div>
                {ageProofData.birthYearOffsetCiphertextHash ? (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="break-all">
                      sha256: {ageProofData.birthYearOffsetCiphertextHash}
                    </span>
                    <Button
                      onClick={() =>
                        copyToClipboard(
                          ageProofData.birthYearOffsetCiphertextHash || "",
                          "ciphertext-hash"
                        )
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {copiedField === "ciphertext-hash" ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : null}
              </div>

              <Alert>
                <Database className="h-4 w-4" />
                <AlertDescription>
                  The FHE ciphertext enables age verification without
                  decryption. The server can compute on this encrypted data to
                  verify your age at any time in the future.
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No FHE ciphertext found. This could mean the FHE service was
                unavailable during registration. Your ZK proofs are still valid
                for verification.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Technical Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proof Types</span>
              <span>{latestProofs.map((p) => p.proofType).join(", ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Noir Version</span>
              <span>{latestProofs[0]?.noirVersion ?? "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">BB Version</span>
              <span>{latestProofs[0]?.bbVersion ?? "N/A"}</span>
            </div>
            {ageProofData && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Age Status</span>
                <Badge
                  variant={ageProofData.isOver18 ? "default" : "destructive"}
                >
                  {ageProofData.isOver18 ? "18+" : "Under 18"}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

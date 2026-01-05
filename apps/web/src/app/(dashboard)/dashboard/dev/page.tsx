"use client";

import type { AgeProofFull } from "@/lib/crypto/age-proof-types";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Code,
  Copy,
  Database,
  Key,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { getUserProof } from "@/lib/crypto/crypto-client";

export default function DevViewPage() {
  const [proofData, setProofData] = useState<AgeProofFull | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);

  useEffect(() => {
    async function fetchProof() {
      try {
        const data = await getUserProof(true);
        setProofData(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load proof data"
        );
      } finally {
        setIsLoading(false);
      }
    }
    fetchProof();
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
          <span>Loading proof data...</span>
        </div>
      </div>
    );
  }

  if (error || !proofData) {
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
                <EmptyTitle>{error || "No Proof Found"}</EmptyTitle>
                <EmptyDescription>
                  Complete the registration process to generate proof data.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild>
                  <Link href="/sign-up">Complete Registration</Link>
                </Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      </div>
    );
  }

  const proofJson = proofData.proof
    ? JSON.stringify(proofData.proof, null, 2)
    : null;
  const signalsJson = proofData.publicSignals
    ? JSON.stringify(proofData.publicSignals, null, 2)
    : null;

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
              <p className="text-muted-foreground text-sm">
                ZK Proof Generation
              </p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatMs(proofData.generationTimeMs)}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">FHE Encryption</p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatMs(proofData.fheEncryptionTimeMs)}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Proof Size</p>
              <p className="truncate font-bold font-mono text-2xl">
                {proofJson ? formatBytes(proofJson.length) : "N/A"}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">Ciphertext Size</p>
              <p className="truncate font-bold font-mono text-2xl">
                {formatBytes(proofData.birthYearOffsetCiphertextBytes)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ZK Proof Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-info" />
            ZK Proof (UltraHonk)
          </CardTitle>
          <CardDescription>
            Zero-knowledge proof of age verification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">UltraHonk</Badge>
            <Badge variant="secondary">BN254 Curve</Badge>
            <Badge variant="secondary">Noir.js</Badge>
            <Badge className="text-xs" variant="success">
              Verified
            </Badge>
          </div>

          {proofJson ? (
            <Collapsible onOpenChange={setProofOpen} open={proofOpen}>
              <CollapsibleTrigger asChild>
                <Button className="w-full justify-between" variant="outline">
                  <span>View Raw Proof JSON</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${proofOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="relative">
                  <Button
                    className="absolute top-2 right-2 z-10"
                    onClick={() => copyToClipboard(proofJson, "proof")}
                    size="sm"
                    variant="ghost"
                  >
                    {copiedField === "proof" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <pre className="max-h-64 overflow-auto break-all rounded-lg bg-muted p-4 font-mono text-xs">
                    {proofJson}
                  </pre>
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
                    onClick={() => copyToClipboard(signalsJson, "signals")}
                    size="sm"
                    variant="ghost"
                  >
                    {copiedField === "signals" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <pre className="max-h-48 overflow-auto break-all rounded-lg bg-muted p-4 font-mono text-xs">
                    {signalsJson}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      </Card>

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
          {proofData.birthYearOffsetCiphertextBytes ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">TFHE-rs</Badge>
                <Badge variant="secondary">Fully Homomorphic</Badge>
                <Badge variant="outline">
                  Key ID: {proofData.fheKeyId || "unregistered"}
                </Badge>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span>Ciphertext size</span>
                  <span>
                    {formatBytes(proofData.birthYearOffsetCiphertextBytes)}
                  </span>
                </div>
                {proofData.birthYearOffsetCiphertextHash ? (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="break-all">
                      sha256: {proofData.birthYearOffsetCiphertextHash}
                    </span>
                    <Button
                      onClick={() =>
                        copyToClipboard(
                          proofData.birthYearOffsetCiphertextHash || "",
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
                unavailable during registration. Your ZK proof is still valid
                for age verification.
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
          <ItemGroup>
            <Item size="sm">
              <ItemContent>
                <ItemDescription>Proof ID</ItemDescription>
              </ItemContent>
              <ItemActions>
                <code className="text-xs">{proofData.proofId}</code>
              </ItemActions>
            </Item>
            <ItemSeparator />
            <Item size="sm">
              <ItemContent>
                <ItemDescription>Created At</ItemDescription>
              </ItemContent>
              <ItemActions>
                <span className="text-sm">
                  {new Date(proofData.createdAt).toLocaleString()}
                </span>
              </ItemActions>
            </Item>
            <ItemSeparator />
            <Item size="sm">
              <ItemContent>
                <ItemDescription>Age Status</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={proofData.isOver18 ? "default" : "destructive"}>
                  {proofData.isOver18 ? "18+" : "Under 18"}
                </Badge>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
  );
}

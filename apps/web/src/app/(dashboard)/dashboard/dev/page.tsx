"use client";

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
import { getUserProof } from "@/lib/crypto-client";

interface FullProofData {
  proofId: string;
  isOver18: boolean;
  createdAt: string;
  generationTimeMs: number;
  proof?: string; // Base64 encoded UltraHonk ZK proof
  publicSignals?: string[];
  dobCiphertext?: string;
  fheClientKeyId?: string;
  fheEncryptionTimeMs?: number;
}

export default function DevViewPage() {
  const [proofData, setProofData] = useState<FullProofData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);
  const [ciphertextOpen, setCiphertextOpen] = useState(false);

  useEffect(() => {
    async function fetchProof() {
      try {
        const data = await getUserProof(true);
        setProofData(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load proof data",
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

  const formatBytes = (str: string): string => {
    const bytes = new Blob([str]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">
          Loading proof data...
        </div>
      </div>
    );
  }

  if (error || !proofData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Developer View</h1>
          <p className="text-muted-foreground">
            Technical details of your cryptographic proofs
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Code className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="font-medium">{error || "No Proof Found"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete the registration process to generate proof data.
            </p>
            <Button asChild className="mt-4">
              <Link href="/sign-up">Complete Registration</Link>
            </Button>
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
        <h1 className="text-2xl font-bold">Developer View</h1>
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
            <Zap className="h-5 w-5 text-yellow-500" />
            Performance Metrics
          </CardTitle>
          <CardDescription>
            Timing data for cryptographic operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                ZK Proof Generation
              </p>
              <p className="text-2xl font-mono font-bold">
                {proofData.generationTimeMs}ms
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">FHE Encryption</p>
              <p className="text-2xl font-mono font-bold">
                {proofData.fheEncryptionTimeMs
                  ? `${proofData.fheEncryptionTimeMs}ms`
                  : "N/A"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Proof Size</p>
              <p className="text-2xl font-mono font-bold">
                {proofJson ? formatBytes(proofJson) : "N/A"}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Ciphertext Size</p>
              <p className="text-2xl font-mono font-bold">
                {proofData.dobCiphertext
                  ? formatBytes(proofData.dobCiphertext)
                  : "N/A"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ZK Proof Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
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
            <Badge variant="outline" className="text-green-600">
              Verified
            </Badge>
          </div>

          {proofJson && (
            <Collapsible open={proofOpen} onOpenChange={setProofOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>View Raw Proof JSON</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${proofOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-10"
                    onClick={() => copyToClipboard(proofJson, "proof")}
                  >
                    {copiedField === "proof" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-4 text-xs">
                    {proofJson}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {signalsJson && (
            <Collapsible open={signalsOpen} onOpenChange={setSignalsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>View Public Signals</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${signalsOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-10"
                    onClick={() => copyToClipboard(signalsJson, "signals")}
                  >
                    {copiedField === "signals" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-4 text-xs">
                    {signalsJson}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* FHE Ciphertext */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-purple-500" />
            FHE Ciphertext (TFHE)
          </CardTitle>
          <CardDescription>
            Encrypted date of birth for homomorphic computation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {proofData.dobCiphertext ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">TFHE-rs</Badge>
                <Badge variant="secondary">Fully Homomorphic</Badge>
                <Badge variant="outline">
                  Key ID: {proofData.fheClientKeyId || "default"}
                </Badge>
              </div>

              <Collapsible
                open={ciphertextOpen}
                onOpenChange={setCiphertextOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span>View Ciphertext (truncated)</span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${ciphertextOpen ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-2 z-10"
                      onClick={() =>
                        copyToClipboard(
                          proofData.dobCiphertext || "",
                          "ciphertext",
                        )
                      }
                    >
                      {copiedField === "ciphertext" ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-4 text-xs break-all">
                      {proofData.dobCiphertext.length > 500
                        ? `${proofData.dobCiphertext.slice(0, 500)}...`
                        : proofData.dobCiphertext}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>

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
            <Clock className="h-5 w-5 text-gray-500" />
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Proof ID</span>
            <code className="text-xs">{proofData.proofId}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created At</span>
            <span>{new Date(proofData.createdAt).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Age Status</span>
            <Badge variant={proofData.isOver18 ? "default" : "destructive"}>
              {proofData.isOver18 ? "18+" : "Under 18"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

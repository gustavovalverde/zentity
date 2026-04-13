"use client";

import type { RouterOutputs } from "@/lib/trpc/client";

import {
  CalendarCheck,
  Check,
  ChevronDown,
  CircleHelp,
  FileCheck,
  FileKey,
  Fingerprint,
  Globe,
  Link as LinkIcon,
  ScanFace,
  SquareTerminal,
  UserCheck,
  X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { getChecks, getProofs } from "@/lib/privacy/zk/prove";

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

const PROOF_TYPE_LABELS: Record<string, string> = {
  age_verification: "Age Verification",
  doc_validity: "Document Validity",
  nationality_membership: "Nationality Membership",
  face_match: "Face Match",
  identity_binding: "Identity Binding",
};

export function VerificationDetails() {
  const collapsibleId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [checksData, setChecksData] = useState<ChecksData | null>(null);
  const [proofsData, setProofsData] = useState<ProofsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!isOpen || hasFetched) {
      return;
    }

    setIsLoading(true);
    Promise.all([getChecks(), getProofs()])
      .then(([checks, proofs]) => {
        setChecksData(checks);
        setProofsData(proofs);
      })
      .catch(() => {
        // Silently fail — section collapses to empty
      })
      .finally(() => {
        setIsLoading(false);
        setHasFetched(true);
      });
  }, [isOpen, hasFetched]);

  const checks = checksData?.checks ?? [];
  const proofs = proofsData?.proofs ?? [];
  const passedCount = checks.filter((c) => c.passed).length;

  return (
    <Card>
      <Collapsible id={collapsibleId} onOpenChange={setIsOpen} open={isOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              className="h-auto w-full justify-between p-0 hover:bg-transparent"
              variant="ghost"
            >
              <CardTitle className="flex items-center gap-2 text-lg">
                <SquareTerminal className="h-5 w-5" />
                Verification Details
              </CardTitle>
              <ChevronDown
                className={`h-5 w-5 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spinner size="sm" />
              </div>
            ) : (
              <>
                {/* Summary stats */}
                {checks.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-muted-foreground text-xs">
                        Checks Passed
                      </p>
                      <p className="font-bold font-mono text-xl">
                        {passedCount} / {checks.length}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-muted-foreground text-xs">
                        Total Proofs
                      </p>
                      <p className="font-bold font-mono text-xl">
                        {proofs.length}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-muted-foreground text-xs">
                        Proof Systems
                      </p>
                      <p className="font-bold font-mono text-xl">
                        {new Set(proofs.map((p) => p.proofSystem)).size}
                      </p>
                    </div>
                  </div>
                )}

                {/* Verification checks */}
                {checks.length > 0 && (
                  <div className="space-y-2">
                    {checks.map((check) => (
                      <div
                        className="flex items-center justify-between rounded-lg border p-3"
                        key={check.checkType}
                      >
                        <div className="flex items-center gap-3">
                          {CHECK_TYPE_ICONS[check.checkType] ?? (
                            <CircleHelp className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium text-sm">
                              {CHECK_TYPE_LABELS[check.checkType] ??
                                check.checkType}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {SOURCE_LABELS[check.source] ?? check.source}
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
                )}

                {/* Proof artifacts */}
                {proofs.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium text-sm">
                      Proof Artifacts ({proofs.length})
                    </p>
                    {proofs.map((proof) => (
                      <div
                        className="flex items-center justify-between rounded-lg border p-3"
                        key={`${proof.proofType}-${proof.proofHash.slice(0, 8)}`}
                      >
                        <div className="flex items-center gap-3">
                          <FileKey className="h-4 w-4 text-info" />
                          <div>
                            <p className="font-medium text-sm">
                              {PROOF_TYPE_LABELS[proof.proofType] ??
                                proof.proofType}
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
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

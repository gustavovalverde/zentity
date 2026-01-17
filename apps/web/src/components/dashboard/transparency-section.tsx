"use client";

import { ChevronDown, Database, Eye, EyeOff, Lock, Shield } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  getAttributeLabel,
  getClaimTypeLabel,
  getProofTypeLabel,
} from "@/lib/constants/verification-labels";

const NEVER_STORED_ITEMS = [
  "ID Document Image",
  "Selfie Image",
  "Full Name",
  "Birth Date",
  "Document Number",
  "Face Embeddings",
  "Address",
] as const;

interface TransparencySectionProps {
  documentHash?: string;
  nameCommitment?: string;
  birthYearOffsetCiphertextHash?: string | null;
  birthYearOffsetCiphertextBytes?: number | null;
  hasAgeProof: boolean;
  proofTypes?: string[];
  encryptedAttributes?: string[];
  signedClaimTypes?: string[];
}

export function TransparencySection({
  documentHash,
  nameCommitment,
  birthYearOffsetCiphertextHash,
  birthYearOffsetCiphertextBytes,
  hasAgeProof,
  proofTypes = [],
  encryptedAttributes = [],
  signedClaimTypes = [],
}: Readonly<TransparencySectionProps>) {
  const [isOpen, setIsOpen] = useState(false);

  const truncateHash = (hash: string) => {
    if (hash.length <= 20) {
      return hash;
    }
    return `${hash.slice(0, 10)}…${hash.slice(-10)}`;
  };

  return (
    <Card>
      <Collapsible onOpenChange={setIsOpen} open={isOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              className="h-auto w-full justify-between p-0 hover:bg-transparent"
              variant="ghost"
            >
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5" />
                What We Store
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
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Lock className="mt-0.5 h-5 w-5 text-info" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Document Hash</span>
                    <Badge className="text-xs" variant="outline">
                      SHA256
                    </Badge>
                  </div>
                  <code className="block font-mono text-muted-foreground text-xs">
                    {documentHash ? truncateHash(documentHash) : "Not verified"}
                  </code>
                  <p className="text-muted-foreground text-xs">
                    One-way hash of document number + salt
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Shield className="mt-0.5 h-5 w-5 text-success" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Name Commitment</span>
                    <Badge className="text-xs" variant="outline">
                      SHA256
                    </Badge>
                  </div>
                  <code className="block font-mono text-muted-foreground text-xs">
                    {nameCommitment
                      ? truncateHash(nameCommitment)
                      : "Not verified"}
                  </code>
                  <p className="text-muted-foreground text-xs">
                    One-way hash of normalized name + salt
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Eye className="mt-0.5 h-5 w-5 text-info" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      Birth Year Offset Ciphertext
                    </span>
                    <Badge className="text-xs" variant="outline">
                      FHE
                    </Badge>
                  </div>
                  <code className="block font-mono text-muted-foreground text-xs">
                    {birthYearOffsetCiphertextBytes
                      ? `${birthYearOffsetCiphertextBytes} bytes`
                      : "Not encrypted"}
                  </code>
                  {birthYearOffsetCiphertextHash ? (
                    <code className="block font-mono text-muted-foreground text-xs">
                      sha256: {truncateHash(birthYearOffsetCiphertextHash)}
                    </code>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Homomorphically encrypted birth year offset
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <Shield className="mt-0.5 h-5 w-5 text-success" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Age Proof</span>
                    <Badge className="text-xs" variant="outline">
                      ZK-SNARK
                    </Badge>
                    {hasAgeProof ? (
                      <Badge className="text-xs" variant="success">
                        Verified 18+
                      </Badge>
                    ) : null}
                  </div>
                  <code className="block font-mono text-muted-foreground text-xs">
                    {hasAgeProof ? "Stored" : "No proof stored"}
                  </code>
                  <p className="text-muted-foreground text-xs">
                    Cryptographic proof that age {"\u2265"} 18 without revealing
                    birth date
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t pt-2">
              <div>
                <h4 className="mb-2 font-medium text-sm">Proofs Stored</h4>
                <div className="flex flex-wrap gap-2">
                  {proofTypes.length === 0 ? (
                    <Badge className="text-xs" variant="outline">
                      None yet
                    </Badge>
                  ) : (
                    proofTypes.map((proof) => (
                      <Badge
                        className="text-xs"
                        key={proof}
                        variant="secondary"
                      >
                        {getProofTypeLabel(proof)}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-medium text-sm">
                  Encrypted Attributes
                </h4>
                <div className="flex flex-wrap gap-2">
                  {encryptedAttributes.length === 0 ? (
                    <Badge className="text-xs" variant="outline">
                      None yet
                    </Badge>
                  ) : (
                    encryptedAttributes.map((attr) => (
                      <Badge className="text-xs" key={attr} variant="secondary">
                        {getAttributeLabel(attr)}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-medium text-sm">Signed Claims</h4>
                <div className="flex flex-wrap gap-2">
                  {signedClaimTypes.length === 0 ? (
                    <Badge className="text-xs" variant="outline">
                      None yet
                    </Badge>
                  ) : (
                    signedClaimTypes.map((claim) => (
                      <Badge
                        className="text-xs"
                        key={claim}
                        variant="secondary"
                      >
                        {getClaimTypeLabel(claim)}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="border-t pt-2">
              <h4 className="mb-2 flex items-center gap-2 font-medium text-sm">
                <EyeOff className="h-4 w-4 text-destructive" />
                What We Never Store in Plaintext
              </h4>
              <p className="mb-2 text-muted-foreground text-xs">
                Encrypted profile fields are stored and can only be unlocked
                with your passkey.
              </p>
              <div className="flex flex-wrap gap-2">
                {NEVER_STORED_ITEMS.map((item) => (
                  <Badge
                    className="border-destructive/30 text-destructive text-xs"
                    key={item}
                    variant="outline"
                  >
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

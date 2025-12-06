"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, Eye, EyeOff, Database, Shield, Lock } from "lucide-react";
import { useState } from "react";

interface TransparencySectionProps {
  documentHash?: string;
  nameCommitment?: string;
  dobCiphertext?: string;
  ageProof?: string;
  ageProofVerified?: boolean;
}

export function TransparencySection({
  documentHash,
  nameCommitment,
  dobCiphertext,
  ageProof,
  ageProofVerified,
}: TransparencySectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const truncateHash = (hash: string) => {
    if (hash.length <= 20) return hash;
    return `${hash.slice(0, 10)}...${hash.slice(-10)}`;
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 h-auto hover:bg-transparent"
            >
              <CardTitle className="text-lg flex items-center gap-2">
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
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                <Lock className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Document Hash</span>
                    <Badge variant="outline" className="text-xs">
                      SHA256
                    </Badge>
                  </div>
                  <code className="text-xs text-muted-foreground block font-mono">
                    {documentHash ? truncateHash(documentHash) : "Not verified"}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    One-way hash of document number + salt
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                <Shield className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Name Commitment</span>
                    <Badge variant="outline" className="text-xs">
                      SHA256
                    </Badge>
                  </div>
                  <code className="text-xs text-muted-foreground block font-mono">
                    {nameCommitment ? truncateHash(nameCommitment) : "Not verified"}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    One-way hash of normalized name + salt
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                <Eye className="h-5 w-5 text-purple-500 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">DOB Ciphertext</span>
                    <Badge variant="outline" className="text-xs">
                      FHE
                    </Badge>
                  </div>
                  <code className="text-xs text-muted-foreground block font-mono">
                    {dobCiphertext ? truncateHash(dobCiphertext) : "Not encrypted"}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Homomorphically encrypted birth year
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                <Shield className="h-5 w-5 text-amber-500 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Age Proof</span>
                    <Badge variant="outline" className="text-xs">
                      ZK-SNARK
                    </Badge>
                    {ageProofVerified && (
                      <Badge className="text-xs bg-green-600">
                        Verified 18+
                      </Badge>
                    )}
                  </div>
                  <code className="text-xs text-muted-foreground block font-mono">
                    {ageProof ? truncateHash(ageProof) : "No proof generated"}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Cryptographic proof that age {"\u2265"} 18 without revealing birth date
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <EyeOff className="h-4 w-4 text-red-500" />
                What We NEVER Store
              </h4>
              <div className="flex flex-wrap gap-2">
                {[
                  "ID Document Image",
                  "Selfie Image",
                  "Full Name",
                  "Birth Date",
                  "Document Number",
                  "Face Embeddings",
                  "Address",
                ].map((item) => (
                  <Badge
                    key={item}
                    variant="outline"
                    className="text-xs text-red-600 border-red-300 dark:border-red-700"
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

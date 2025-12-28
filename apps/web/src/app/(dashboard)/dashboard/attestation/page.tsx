import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnChainAttestation } from "@/components/dashboard/on-chain-attestation";
import { ViewIdentityData } from "@/components/dashboard/view-identity-data";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/auth";
import {
  getEncryptedAttributeTypesByUserId,
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
  getSignedClaimTypesByUserId,
  getVerificationStatus,
  getZkProofsByUserId,
} from "@/lib/db";
import { isWeb3Enabled } from "@/lib/feature-flags";

export default async function AttestationPage() {
  // Redirect if Web3 is disabled
  if (!isWeb3Enabled()) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const userId = session?.user?.id;
  const verificationStatus = userId ? getVerificationStatus(userId) : null;
  const isVerified = verificationStatus?.verified ?? false;
  const identityBundle = userId ? getIdentityBundleByUserId(userId) : null;
  const latestDocument = userId
    ? getLatestIdentityDocumentByUserId(userId)
    : null;
  const zkProofs = userId ? getZkProofsByUserId(userId) : [];
  const proofTypes = Array.from(
    new Set(zkProofs.map((proof) => proof.proofType)),
  );
  const encryptedAttributes = userId
    ? getEncryptedAttributeTypesByUserId(userId)
    : [];
  const signedClaimTypes = userId ? getSignedClaimTypesByUserId(userId) : [];

  const proofLabels: Record<string, string> = {
    age_verification: "Age ≥ 18",
    doc_validity: "Document Valid",
    nationality_membership: "Nationality Group",
    face_match: "Face Match",
  };

  const claimLabels: Record<string, string> = {
    liveness_score: "Liveness Score",
    face_match_score: "Face Match Score",
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">On-Chain Attestation</h1>
          <p className="text-muted-foreground">
            Register your verified identity on blockchain networks
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Off-Chain Attestation</CardTitle>
          <CardDescription>
            Latest identity bundle, document, proofs, and encrypted attributes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Bundle Status</p>
              <p className="font-medium capitalize">
                {identityBundle?.status ?? "pending"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Policy Version</p>
              <p className="font-medium">
                {identityBundle?.policyVersion ?? "unversioned"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Issuer</p>
              <p className="font-medium">
                {identityBundle?.issuerId ?? "zentity-attestation"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Document Type</p>
              <p className="font-medium">
                {latestDocument?.documentType ?? "not available"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Issuer Country</p>
              <p className="font-medium">
                {latestDocument?.issuerCountry ?? "not available"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Document Status</p>
              <p className="font-medium capitalize">
                {latestDocument?.status ?? "pending"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Verified At</p>
              <p className="font-medium">
                {latestDocument?.verifiedAt
                  ? new Date(latestDocument.verifiedAt).toLocaleDateString()
                  : "not available"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Proofs</p>
            <div className="flex flex-wrap gap-2">
              {proofTypes.length === 0 ? (
                <Badge variant="outline" className="text-xs">
                  None stored yet
                </Badge>
              ) : (
                proofTypes.map((proof) => (
                  <Badge key={proof} variant="secondary" className="text-xs">
                    {proofLabels[proof] ?? proof}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Signed Claims</p>
            <div className="flex flex-wrap gap-2">
              {signedClaimTypes.length === 0 ? (
                <Badge variant="outline" className="text-xs">
                  None stored yet
                </Badge>
              ) : (
                signedClaimTypes.map((claim) => (
                  <Badge key={claim} variant="secondary" className="text-xs">
                    {claimLabels[claim] ?? claim}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Encrypted Attributes</p>
            <div className="flex flex-wrap gap-2">
              {encryptedAttributes.length === 0 ? (
                <Badge variant="outline" className="text-xs">
                  None stored yet
                </Badge>
              ) : (
                encryptedAttributes.map((attr) => (
                  <Badge key={attr} variant="secondary" className="text-xs">
                    {attr}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <OnChainAttestation isVerified={isVerified} />
      <ViewIdentityData />
    </div>
  );
}

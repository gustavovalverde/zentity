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
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
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
  const verificationStatus = userId
    ? await getVerificationStatus(userId)
    : null;
  const isVerified = verificationStatus?.verified ?? false;
  const identityBundle = userId
    ? await getIdentityBundleByUserId(userId)
    : null;
  const latestDocument = userId
    ? await getSelectedIdentityDocumentByUserId(userId)
    : null;
  const selectedDocumentId = latestDocument?.id ?? null;
  const proofTypes =
    userId && selectedDocumentId
      ? await getZkProofTypesByUserAndDocument(userId, selectedDocumentId)
      : [];
  const encryptedAttributes = userId
    ? await getEncryptedAttributeTypesByUserId(userId)
    : [];
  const signedClaimTypes =
    userId && selectedDocumentId
      ? await getSignedClaimTypesByUserAndDocument(userId, selectedDocumentId)
      : [];

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
          <h1 className="font-bold text-3xl">On-Chain Attestation</h1>
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
              <p className="text-muted-foreground text-xs">Bundle Status</p>
              <p className="font-medium capitalize">
                {identityBundle?.status ?? "pending"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Policy Version</p>
              <p className="font-medium">
                {identityBundle?.policyVersion ?? "unversioned"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Issuer</p>
              <p className="font-medium">
                {identityBundle?.issuerId ?? "zentity-attestation"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Document Type</p>
              <p className="font-medium">
                {latestDocument?.documentType ?? "not available"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Issuer Country</p>
              <p className="font-medium">
                {latestDocument?.issuerCountry ?? "not available"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Document Status</p>
              <p className="font-medium capitalize">
                {latestDocument?.status ?? "pending"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Verified At</p>
              <p className="font-medium">
                {latestDocument?.verifiedAt
                  ? new Date(latestDocument.verifiedAt).toLocaleDateString()
                  : "not available"}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 font-medium text-sm">Proofs</p>
            <div className="flex flex-wrap gap-2">
              {proofTypes.length === 0 ? (
                <Badge className="text-xs" variant="outline">
                  None stored yet
                </Badge>
              ) : (
                proofTypes.map((proof) => (
                  <Badge className="text-xs" key={proof} variant="secondary">
                    {proofLabels[proof] ?? proof}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 font-medium text-sm">Signed Claims</p>
            <div className="flex flex-wrap gap-2">
              {signedClaimTypes.length === 0 ? (
                <Badge className="text-xs" variant="outline">
                  None stored yet
                </Badge>
              ) : (
                signedClaimTypes.map((claim) => (
                  <Badge className="text-xs" key={claim} variant="secondary">
                    {claimLabels[claim] ?? claim}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 font-medium text-sm">Encrypted Attributes</p>
            <div className="flex flex-wrap gap-2">
              {encryptedAttributes.length === 0 ? (
                <Badge className="text-xs" variant="outline">
                  None stored yet
                </Badge>
              ) : (
                encryptedAttributes.map((attr) => (
                  <Badge className="text-xs" key={attr} variant="secondary">
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

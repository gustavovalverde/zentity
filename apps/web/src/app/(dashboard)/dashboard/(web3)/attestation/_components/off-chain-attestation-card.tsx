import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getClaimTypeLabel,
  getProofTypeLabel,
} from "@/lib/constants/verification-labels";
import {
  getEncryptedAttributeTypesByUserId,
  getSignedClaimTypesByUserAndDocument,
  getZkProofTypesByUserAndDocument,
} from "@/lib/db/queries/crypto";
import {
  getIdentityBundleByUserId,
  getSelectedIdentityDocumentByUserId,
} from "@/lib/db/queries/identity";

interface OffChainAttestationCardProps {
  userId: string | undefined;
}

export async function OffChainAttestationCard({
  userId,
}: OffChainAttestationCardProps) {
  // First batch: parallelize independent queries
  const [identityBundle, latestDocument, encryptedAttributes] = userId
    ? await Promise.all([
        getIdentityBundleByUserId(userId),
        getSelectedIdentityDocumentByUserId(userId),
        getEncryptedAttributeTypesByUserId(userId),
      ])
    : [null, null, []];

  // Second batch: queries depending on selectedDocumentId
  const selectedDocumentId = latestDocument?.id ?? null;
  const [proofTypes, signedClaimTypes] =
    userId && selectedDocumentId
      ? await Promise.all([
          getZkProofTypesByUserAndDocument(userId, selectedDocumentId),
          getSignedClaimTypesByUserAndDocument(userId, selectedDocumentId),
        ])
      : [[], []];

  return (
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
                  {getProofTypeLabel(proof)}
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
                  {getClaimTypeLabel(claim)}
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
  );
}

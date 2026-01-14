import {
  getIdentityBundleByUserId,
  getLatestIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";

export async function getDemoIdentityStatus(userId: string) {
  const [verification, bundle, document] = await Promise.all([
    getVerificationStatus(userId),
    getIdentityBundleByUserId(userId),
    getLatestIdentityDocumentByUserId(userId),
  ]);

  return {
    verification,
    bundle: bundle
      ? {
          status: bundle.status,
          policyVersion: bundle.policyVersion ?? null,
          issuerId: bundle.issuerId ?? null,
          attestationExpiresAt: bundle.attestationExpiresAt ?? null,
          fheStatus: bundle.fheStatus ?? null,
          fheError: bundle.fheError ?? null,
          updatedAt: bundle.updatedAt ?? null,
        }
      : null,
    document: document
      ? {
          id: document.id,
          verifiedAt: document.verifiedAt ?? null,
          status: document.status,
          issuerCountry: document.issuerCountry ?? null,
          documentType: document.documentType ?? null,
        }
      : null,
  };
}

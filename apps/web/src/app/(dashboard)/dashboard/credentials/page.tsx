import { PageHeader } from "@/components/layouts/page-header";

import { CredentialsContent } from "./_components/credentials-content";

export default function CredentialsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Issue verifiable credentials to store in your wallet"
        title="Verifiable Credentials"
      />
      <CredentialsContent />
    </div>
  );
}

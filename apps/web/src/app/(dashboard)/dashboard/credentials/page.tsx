import { CredentialsContent } from "./_components/credentials-content";

export default function CredentialsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-bold text-2xl">Verifiable Credentials</h1>
        <p className="text-muted-foreground text-sm">
          Issue verifiable credentials to store in your wallet
        </p>
      </div>

      {/* Content */}
      <CredentialsContent />
    </div>
  );
}

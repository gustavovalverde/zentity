"use client";

/**
 * Exchange Simulator Demo (Authenticated)
 *
 * This is the authenticated version of the exchange demo.
 * For public access, see /demo/exchange
 */

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  buildDisclosurePayload,
  type DisclosureField,
  encryptDisclosurePayload,
} from "@/lib/privacy/crypto/disclosure-client";
import { getStoredProfile } from "@/lib/privacy/crypto/profile-secret";

// Types for the demo
interface ExchangeKeypair {
  publicKey: string;
  privateKey: string;
}

interface DisclosurePackage {
  encryptedPackage: string;
  encryptedFields: string[];
  proofs: {
    ageProof?: { proof: string; publicSignals: string[] };
    faceMatchProof?: { proof: string; publicSignals: string[] };
    docValidityProof?: { proof: string; publicSignals: string[] };
    livenessAttestation?: {
      verified: boolean;
      timestamp: string;
      method: string;
    };
  };
}

interface DecryptedPii {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  documentNumber: string;
}

interface VerificationResults {
  ageProofValid?: boolean;
  faceMatchValid?: boolean;
  docValidityValid?: boolean;
  livenessValid: boolean;
}

type DemoStep =
  | "intro"
  | "exchange-request"
  | "user-consent"
  | "disclosure"
  | "verification"
  | "summary";

const DEMO_STEPS: DemoStep[] = [
  "intro",
  "exchange-request",
  "user-consent",
  "disclosure",
  "verification",
  "summary",
];

function getStepProgress(currentStep: DemoStep): number {
  const index = DEMO_STEPS.indexOf(currentStep);
  return ((index + 1) / DEMO_STEPS.length) * 100;
}

function getStatusBadgeVariant(
  status: boolean | undefined
): "success" | "destructive" | "secondary" {
  if (status === undefined) {
    return "secondary";
  }
  return status ? "success" : "destructive";
}

function getStatusLabel(status: boolean | undefined): string {
  if (status === undefined) {
    return "N/A";
  }
  return status ? "Valid" : "Invalid";
}

export default function ExchangeDemoPage() {
  const [step, setStep] = useState<DemoStep>("intro");
  const [exchangeKeypair, setExchangeKeypair] =
    useState<ExchangeKeypair | null>(null);
  const [disclosurePackage, setDisclosurePackage] =
    useState<DisclosurePackage | null>(null);
  const [decryptedPii, setDecryptedPii] = useState<DecryptedPii | null>(null);
  const [verificationResults, setVerificationResults] =
    useState<VerificationResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Step 1: Exchange generates keypair
  const handleGenerateKeypair = async () => {
    setIsLoading(true);
    setFlowError(null);
    try {
      const res = await fetch("/api/demo/exchange/keypair", { method: "POST" });
      const data = await res.json();
      setExchangeKeypair(data);
      setStep("exchange-request");
    } catch (error) {
      setFlowError(
        `Failed to generate exchange keypair: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    setIsLoading(false);
  };

  // Step 2: User consents and Zentity creates disclosure package
  const handleUserConsent = async () => {
    if (!exchangeKeypair) {
      return;
    }
    setIsLoading(true);
    setFlowError(null);
    try {
      const profile = await getStoredProfile();
      const scope: DisclosureField[] = [
        "fullName",
        "dateOfBirth",
        "nationality",
        "documentNumber",
      ];
      const packageId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString();
      const { payload, encryptedFields } = buildDisclosurePayload({
        profile,
        scope,
        rpId: "crypto-exchange-demo",
        packageId,
        createdAt,
        expiresAt,
      });
      const encryptedPackage = await encryptDisclosurePayload(
        JSON.stringify(payload),
        exchangeKeypair.publicKey
      );

      const res = await fetch("/api/identity/disclosure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rpId: "crypto-exchange-demo",
          rpName: "CryptoExchange Inc.",
          packageId,
          createdAt,
          expiresAt,
          encryptedPackage,
          scope: encryptedFields,
        }),
      });
      const data = await res.json();
      setDisclosurePackage(data);
      setStep("disclosure");
    } catch (error) {
      setFlowError(
        `Failed to create disclosure package: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Exchange decrypts PII
  const handleDecryptPii = async () => {
    if (!(disclosurePackage && exchangeKeypair)) {
      return;
    }
    setIsLoading(true);
    setFlowError(null);
    try {
      const res = await fetch("/api/demo/exchange/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPackage: disclosurePackage.encryptedPackage,
          privateKey: exchangeKeypair.privateKey,
        }),
      });
      const data = await res.json();
      setDecryptedPii(data.pii);
      setStep("verification");
    } catch (error) {
      setFlowError(
        `Failed to decrypt PII: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    setIsLoading(false);
  };

  // Step 4: Exchange verifies proofs
  const handleVerifyProofs = async () => {
    if (!disclosurePackage) {
      return;
    }
    setIsLoading(true);
    setFlowError(null);
    try {
      const res = await fetch("/api/demo/exchange/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofs: disclosurePackage.proofs }),
      });
      const data = await res.json();
      setVerificationResults({
        ...data,
        livenessValid:
          disclosurePackage.proofs.livenessAttestation?.verified ?? false,
      });
      setStep("summary");
    } catch (error) {
      setFlowError(
        `Failed to verify proofs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    setIsLoading(false);
  };

  const resetDemo = () => {
    setStep("intro");
    setExchangeKeypair(null);
    setDisclosurePackage(null);
    setDecryptedPii(null);
    setVerificationResults(null);
    setFlowError(null);
  };

  const ageStatus = verificationResults?.ageProofValid;
  const faceMatchStatus = verificationResults?.faceMatchValid;
  const docValidityStatus = verificationResults?.docValidityValid;
  const livenessStatus = verificationResults?.livenessValid;
  const hasAnyFailure =
    ageStatus === false ||
    faceMatchStatus === false ||
    docValidityStatus === false ||
    livenessStatus === false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Exchange Simulator</h1>
        <p className="text-muted-foreground text-sm">
          Demonstrates privacy-preserving identity verification for regulated
          entities
        </p>
      </div>

      {/* Progress indicator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Step {DEMO_STEPS.indexOf(step) + 1} of {DEMO_STEPS.length}
          </span>
          <span className="font-medium">
            {Math.round(getStepProgress(step))}%
          </span>
        </div>
        <Progress value={getStepProgress(step)} />
      </div>

      {/* Step content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Current step */}
        <Card>
          <CardHeader>
            <CardTitle>
              {step === "intro" && "Welcome to the Exchange Demo"}
              {step === "exchange-request" &&
                "Step 1: Exchange Requests Verification"}
              {step === "user-consent" && "Step 2: User Consent"}
              {step === "disclosure" && "Step 3: Disclosure Package Created"}
              {step === "verification" && "Step 4: Verify Proofs"}
              {step === "summary" && "Verification Complete"}
            </CardTitle>
            <CardDescription>
              {step === "intro" &&
                "Simulates a crypto exchange requesting identity verification from a Zentity user."}
              {step === "exchange-request" &&
                "The exchange has generated a keypair to receive encrypted data."}
              {step === "user-consent" &&
                "Review the data request and approve or deny."}
              {step === "disclosure" &&
                "The disclosure package has been created and encrypted."}
              {step === "verification" &&
                "PII has been decrypted. Now verify the ZK proofs."}
              {step === "summary" && "All verifications have been processed."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {flowError && (
              <Alert variant="destructive">
                <AlertDescription>{flowError}</AlertDescription>
              </Alert>
            )}

            {step === "intro" && (
              <>
                <div className="rounded-lg border p-4">
                  <p className="mb-2 font-medium text-sm">The Flow:</p>
                  <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-sm">
                    <li>Exchange generates RSA keypair</li>
                    <li>User consents to share data</li>
                    <li>Client encrypts disclosure package to RP</li>
                    <li>Exchange decrypts PII and verifies proofs</li>
                  </ol>
                </div>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleGenerateKeypair}
                >
                  {isLoading && <Spinner className="mr-2" />}
                  Start Demo as Exchange
                </Button>
              </>
            )}

            {step === "exchange-request" && (
              <>
                <Alert variant="success">
                  <AlertDescription>
                    Exchange keypair generated
                  </AlertDescription>
                </Alert>
                <div className="rounded-lg border p-4">
                  <p className="mb-2 font-medium text-sm">
                    Exchange Public Key:
                  </p>
                  <code className="block break-all text-muted-foreground text-xs">
                    {exchangeKeypair?.publicKey.substring(0, 100)}…
                  </code>
                </div>
                <p className="text-muted-foreground text-sm">
                  The exchange sends their public key. The client encrypts the
                  disclosure package to this key after passkey consent.
                </p>
                <Button
                  className="w-full"
                  onClick={() => setStep("user-consent")}
                >
                  Continue to User Consent
                </Button>
              </>
            )}

            {step === "user-consent" && (
              <>
                <Alert variant="warning">
                  <AlertTitle className="text-sm">Consent Request</AlertTitle>
                  <AlertDescription>
                    <strong>CryptoExchange Inc.</strong> is requesting access
                    to:
                    <ul className="mt-2 list-inside list-disc text-muted-foreground text-sm">
                      <li>Full Name</li>
                      <li>Date of Birth</li>
                      <li>Nationality</li>
                      <li>Document Number</li>
                      <li>Identity Verification Proofs</li>
                    </ul>
                  </AlertDescription>
                </Alert>
                <div className="flex gap-4">
                  <Button
                    className="flex-1"
                    onClick={resetDemo}
                    variant="outline"
                  >
                    Deny
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={isLoading}
                    onClick={handleUserConsent}
                  >
                    {isLoading && <Spinner className="mr-2" />}
                    Approve
                  </Button>
                </div>
              </>
            )}

            {step === "disclosure" && (
              <>
                <Alert variant="success">
                  <AlertDescription>
                    Package created and encrypted
                  </AlertDescription>
                </Alert>
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <p className="mb-1 font-medium text-sm">Encrypted PII:</p>
                    <code className="block truncate text-muted-foreground text-xs">
                      {disclosurePackage?.encryptedPackage.substring(0, 50)}…
                    </code>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-sm">Proofs included:</p>
                    <div className="flex flex-wrap gap-2">
                      {disclosurePackage?.proofs.ageProof && (
                        <Badge variant="secondary">Age</Badge>
                      )}
                      {disclosurePackage?.proofs.faceMatchProof && (
                        <Badge variant="secondary">Face Match</Badge>
                      )}
                      {disclosurePackage?.proofs.docValidityProof && (
                        <Badge variant="secondary">Doc Validity</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleDecryptPii}
                >
                  {isLoading && <Spinner className="mr-2" />}
                  Exchange: Decrypt PII
                </Button>
              </>
            )}

            {step === "verification" && (
              <>
                <Alert variant="success">
                  <AlertDescription>
                    PII decrypted successfully
                  </AlertDescription>
                </Alert>
                <div className="rounded-lg border p-4">
                  <p className="mb-2 font-medium text-sm">Decrypted PII:</p>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Name:</span>{" "}
                      {decryptedPii?.fullName}
                    </p>
                    <p>
                      <span className="text-muted-foreground">DOB:</span>{" "}
                      {decryptedPii?.dateOfBirth}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        Nationality:
                      </span>{" "}
                      {decryptedPii?.nationality}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Document:</span>{" "}
                      {decryptedPii?.documentNumber}
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleVerifyProofs}
                >
                  {isLoading && <Spinner className="mr-2" />}
                  Verify ZK Proofs
                </Button>
              </>
            )}

            {step === "summary" && (
              <>
                {hasAnyFailure ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      One or more verifications failed
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="success">
                    <AlertDescription>
                      All verifications passed
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  {[
                    { label: "Age Proof", status: ageStatus },
                    { label: "Face Match Proof", status: faceMatchStatus },
                    { label: "Document Validity", status: docValidityStatus },
                    { label: "Liveness Attestation", status: livenessStatus },
                  ].map(({ label, status }) => (
                    <div
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                      key={label}
                    >
                      <span className="text-sm">{label}</span>
                      <Badge variant={getStatusBadgeVariant(status)}>
                        {getStatusLabel(status)}
                      </Badge>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full"
                  onClick={resetDemo}
                  variant="outline"
                >
                  Restart Demo
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right: Data storage comparison */}
        <Card>
          <CardHeader>
            <CardTitle>What Each Party Stores</CardTitle>
            <CardDescription>
              Privacy comparison between Zentity and Exchange
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Zentity */}
            <div>
              <p className="mb-2 font-medium text-sm">Zentity Stores:</p>
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <p className="text-success">
                  SHA256(name + salt){" "}
                  <span className="text-muted-foreground">commitment</span>
                </p>
                <p className="text-success">
                  SHA256(doc_number + salt){" "}
                  <span className="text-muted-foreground">commitment</span>
                </p>
                <p className="text-success">
                  FHE(birth_year_offset){" "}
                  <span className="text-muted-foreground">encrypted</span>
                </p>
                <p className="text-success">
                  user_salt{" "}
                  <span className="text-muted-foreground">
                    used for GDPR erasure
                  </span>
                </p>
                <p className="text-muted-foreground line-through">
                  Document image{" "}
                  <span className="text-muted-foreground">never stored</span>
                </p>
                <p className="text-muted-foreground line-through">
                  Face embeddings{" "}
                  <span className="text-muted-foreground">never stored</span>
                </p>
              </div>
            </div>

            {/* Exchange */}
            <div>
              <p className="mb-2 font-medium text-sm">
                Exchange Receives & Stores:
              </p>
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <p className="text-warning">
                  Full Name{" "}
                  <span className="text-muted-foreground">
                    regulatory requirement
                  </span>
                </p>
                <p className="text-warning">
                  Date of Birth{" "}
                  <span className="text-muted-foreground">
                    regulatory requirement
                  </span>
                </p>
                <p className="text-warning">
                  Nationality{" "}
                  <span className="text-muted-foreground">
                    regulatory requirement
                  </span>
                </p>
                <p className="text-success">
                  ZK Proofs{" "}
                  <span className="text-muted-foreground">
                    cryptographic verification
                  </span>
                </p>
                <p className="text-muted-foreground line-through">
                  Biometrics{" "}
                  <span className="text-muted-foreground">never disclosed</span>
                </p>
              </div>
            </div>

            {/* Key insight */}
            <Alert>
              <AlertTitle className="text-sm">Key Privacy Wins</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1 text-muted-foreground text-sm">
                  <li>Biometrics never leave Zentity</li>
                  <li>Zentity never stores plaintext PII long-term</li>
                  <li>Exchange gets regulatory compliance</li>
                  <li>ZK proofs provide cryptographic assurance</li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

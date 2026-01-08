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
import { Spinner } from "@/components/ui/spinner";
import {
  buildDisclosurePayload,
  type DisclosureField,
  encryptDisclosurePayload,
} from "@/lib/crypto/disclosure-client";
import { getStoredProfile } from "@/lib/crypto/profile-secret";

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

function getStepBgClass(
  currentStep: DemoStep,
  stepToCheck: string,
  index: number
): string {
  if (currentStep === stepToCheck) {
    return "bg-info";
  }
  if (index < DEMO_STEPS.indexOf(currentStep)) {
    return "bg-success";
  }
  return "bg-muted";
}

function getStatusLabel(status: boolean | undefined): string {
  if (status === undefined) {
    return "N/A";
  }
  return status ? "Valid" : "Invalid";
}

function getStatusBgClass(status: boolean | undefined): string {
  if (status === undefined) {
    return "bg-muted";
  }
  return status ? "bg-success" : "bg-destructive";
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
        <p className="text-muted-foreground">
          Demonstrates privacy-preserving identity verification for regulated
          entities
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex gap-2">
        {[
          "intro",
          "exchange-request",
          "user-consent",
          "disclosure",
          "verification",
          "summary",
        ].map((s, i) => (
          <div
            className={`h-2 flex-1 rounded ${getStepBgClass(step, s, i)}`}
            key={s}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Current step */}
        <Card>
          <CardContent className="pt-6">
            {flowError ? (
              <Alert className="mb-4" variant="destructive">
                <AlertDescription>{flowError}</AlertDescription>
              </Alert>
            ) : null}
            {step === "intro" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Welcome to the Exchange Demo
                </h2>
                <p className="mb-4 text-muted-foreground">
                  This demo simulates a crypto exchange requesting identity
                  verification from a Zentity user.
                </p>
                <Card className="mb-4 bg-muted/40 shadow-none">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">The Flow:</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pt-0 pb-4">
                    <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-sm">
                      <li>Exchange generates RSA keypair</li>
                      <li>User consents to share data</li>
                      <li>Client encrypts disclosure package to RP</li>
                      <li>Exchange decrypts PII and verifies proofs</li>
                    </ol>
                  </CardContent>
                </Card>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleGenerateKeypair}
                  type="button"
                >
                  {isLoading ? (
                    <Spinner aria-hidden="true" className="mr-2" />
                  ) : null}
                  Start Demo as Exchange
                </Button>
              </div>
            )}

            {step === "exchange-request" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Step 1: Exchange Requests Verification
                </h2>
                <Alert className="mb-4" variant="success">
                  <AlertDescription>
                    Exchange keypair generated
                  </AlertDescription>
                </Alert>
                <Card className="mb-4 bg-muted/40 shadow-none">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">
                      Exchange Public Key:
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pt-0 pb-4">
                    <code className="block break-all text-muted-foreground text-xs">
                      {exchangeKeypair?.publicKey.substring(0, 100)}…
                    </code>
                  </CardContent>
                </Card>
                <p className="mb-4 text-muted-foreground text-sm">
                  The exchange sends their public key. The client encrypts the
                  disclosure package to this key after passkey consent.
                </p>
                <Button
                  className="w-full"
                  onClick={() => setStep("user-consent")}
                  type="button"
                >
                  Continue to User Consent
                </Button>
              </div>
            )}

            {step === "user-consent" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Step 2: User Consent
                </h2>
                <Alert className="mb-4" variant="warning">
                  <AlertTitle className="text-sm">Consent Request</AlertTitle>
                  <AlertDescription className="text-sm">
                    <strong>CryptoExchange Inc.</strong> is requesting access
                    to:
                  </AlertDescription>
                  <ul className="mt-2 list-inside list-disc text-muted-foreground text-sm">
                    <li>Full Name</li>
                    <li>Date of Birth</li>
                    <li>Nationality</li>
                    <li>Document Number</li>
                    <li>Identity Verification Proofs</li>
                  </ul>
                </Alert>
                <div className="flex gap-4">
                  <Button
                    className="flex-1"
                    onClick={resetDemo}
                    type="button"
                    variant="outline"
                  >
                    Deny
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={isLoading}
                    onClick={handleUserConsent}
                    type="button"
                  >
                    {isLoading ? (
                      <Spinner aria-hidden="true" className="mr-2" />
                    ) : null}
                    Approve
                  </Button>
                </div>
              </div>
            )}

            {step === "disclosure" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Step 3: Disclosure Package Created
                </h2>
                <Alert className="mb-4" variant="success">
                  <AlertDescription>
                    Package created and encrypted
                  </AlertDescription>
                </Alert>
                <div className="mb-4 space-y-2 rounded border bg-muted/40 p-4">
                  <div>
                    <span className="text-muted-foreground text-sm">
                      Encrypted PII:
                    </span>
                    <code className="block truncate text-info text-xs">
                      {disclosurePackage?.encryptedPackage.substring(0, 50)}…
                    </code>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-sm">
                      Proofs included:
                    </span>
                    <div className="mt-1 flex gap-2">
                      {disclosurePackage?.proofs.ageProof ? (
                        <Badge className="text-xs" variant="info">
                          Age
                        </Badge>
                      ) : null}
                      {disclosurePackage?.proofs.faceMatchProof ? (
                        <Badge className="text-xs" variant="info">
                          Face Match
                        </Badge>
                      ) : null}
                      {disclosurePackage?.proofs.docValidityProof ? (
                        <Badge className="text-xs" variant="info">
                          Doc Validity
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleDecryptPii}
                  type="button"
                >
                  {isLoading ? (
                    <Spinner aria-hidden="true" className="mr-2" />
                  ) : null}
                  Exchange: Decrypt PII
                </Button>
              </div>
            )}

            {step === "verification" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Step 4: Verify Proofs
                </h2>
                <Alert className="mb-4" variant="success">
                  <AlertDescription>
                    PII decrypted successfully
                  </AlertDescription>
                </Alert>
                <Card className="mb-4 bg-muted/40 shadow-none">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">Decrypted PII:</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 px-4 pt-0 pb-4 text-sm">
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
                  </CardContent>
                </Card>
                <Button
                  className="w-full"
                  disabled={isLoading}
                  onClick={handleVerifyProofs}
                  type="button"
                >
                  {isLoading ? (
                    <Spinner aria-hidden="true" className="mr-2" />
                  ) : null}
                  Verify ZK Proofs
                </Button>
              </div>
            )}

            {step === "summary" && (
              <div>
                <h2 className="mb-4 font-semibold text-xl">
                  Verification Complete
                </h2>
                {hasAnyFailure ? (
                  <Alert className="mb-4" variant="destructive">
                    <AlertDescription>
                      One or more verifications failed
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className="mb-4" variant="success">
                    <AlertDescription>
                      All verifications passed
                    </AlertDescription>
                  </Alert>
                )}
                <div className="mb-4 space-y-2">
                  {[
                    { label: "Age Proof", status: ageStatus },
                    { label: "Face Match Proof", status: faceMatchStatus },
                    {
                      label: "Document Validity Proof",
                      status: docValidityStatus,
                    },
                    { label: "Liveness Attestation", status: livenessStatus },
                  ].map(({ label, status }) => (
                    <div className="flex items-center gap-2" key={label}>
                      <span
                        className={`h-4 w-4 rounded-full ${getStatusBgClass(status)}`}
                      />
                      <span>
                        {label}: {getStatusLabel(status)}
                      </span>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full"
                  onClick={resetDemo}
                  type="button"
                  variant="outline"
                >
                  Restart Demo
                </Button>
              </div>
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
              <h3 className="mb-2 font-medium text-info">Zentity Stores:</h3>
              <Card className="bg-muted/40 shadow-none">
                <CardContent className="space-y-1 p-3 text-sm">
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
                  <p className="text-destructive line-through">
                    Document image{" "}
                    <span className="text-muted-foreground">never stored</span>
                  </p>
                  <p className="text-destructive line-through">
                    Face embeddings{" "}
                    <span className="text-muted-foreground">never stored</span>
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Exchange */}
            <div>
              <h3 className="mb-2 font-medium text-info">
                Exchange Receives & Stores:
              </h3>
              <Card className="bg-muted/40 shadow-none">
                <CardContent className="space-y-1 p-3 text-sm">
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
                  <p className="text-destructive line-through">
                    Biometrics{" "}
                    <span className="text-muted-foreground">
                      never disclosed
                    </span>
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Key insight */}
            <div className="rounded border border-info/30 bg-info/10 p-4">
              <h3 className="mb-2 font-medium text-info">Key Privacy Wins:</h3>
              <ul className="space-y-1 text-muted-foreground text-sm">
                <li>Biometrics never leave Zentity</li>
                <li>Zentity never stores plaintext PII long-term</li>
                <li>Exchange gets regulatory compliance</li>
                <li>ZK proofs provide cryptographic assurance</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

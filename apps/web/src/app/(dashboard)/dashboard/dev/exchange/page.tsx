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
import {
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
} from "@/lib/crypto";

// Types for the demo
interface ExchangeKeypair {
  publicKey: string;
  privateKey: string;
}

interface DisclosurePackage {
  encryptedPii: {
    iv: string;
    encryptedData: string;
    encryptedAesKey: string;
  };
  proofs: {
    ageProof?: { proof: string; publicSignals: string[] };
    faceMatchProof?: { proof: string; publicSignals: string[] };
    docValidityProof?: { proof: string; publicSignals: string[] };
  };
  livenessAttestation: {
    verified: boolean;
    timestamp: string;
    signature: string;
  };
  metadata: {
    issuedAt: string;
    expiresAt: string;
    rpId: string;
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
        `Failed to generate exchange keypair: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setIsLoading(false);
  };

  // Step 2: User consents and Zentity creates disclosure package
  const handleUserConsent = async () => {
    if (!exchangeKeypair) return;
    setIsLoading(true);
    setFlowError(null);
    try {
      const results = await Promise.allSettled([
        generateAgeProof(1990, new Date().getFullYear(), 18),
        generateFaceMatchProof(8000, 6000),
        generateDocValidityProof(20271231),
      ]);

      const [ageProof, faceMatchProof, docValidityProof] = results;
      if (
        ageProof.status !== "fulfilled" ||
        faceMatchProof.status !== "fulfilled" ||
        docValidityProof.status !== "fulfilled"
      ) {
        const details = [
          ageProof.status === "rejected" ? `age: ${ageProof.reason}` : null,
          faceMatchProof.status === "rejected"
            ? `face_match: ${faceMatchProof.reason}`
            : null,
          docValidityProof.status === "rejected"
            ? `doc_validity: ${docValidityProof.reason}`
            : null,
        ]
          .filter(Boolean)
          .join(" | ");
        setFlowError(`Failed to generate one or more proofs: ${details}`);
        return;
      }

      const res = await fetch("/api/demo/exchange/mock-disclosure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rpPublicKey: exchangeKeypair.publicKey,
          proofs: {
            ageProof: {
              proof: ageProof.value.proof,
              publicSignals: ageProof.value.publicSignals,
            },
            faceMatchProof: {
              proof: faceMatchProof.value.proof,
              publicSignals: faceMatchProof.value.publicSignals,
            },
            docValidityProof: {
              proof: docValidityProof.value.proof,
              publicSignals: docValidityProof.value.publicSignals,
            },
          },
        }),
      });
      const data = await res.json();
      setDisclosurePackage(data);
      setStep("disclosure");
    } catch (error) {
      setFlowError(
        `Failed to create disclosure package: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Exchange decrypts PII
  const handleDecryptPii = async () => {
    if (!disclosurePackage || !exchangeKeypair) return;
    setIsLoading(true);
    setFlowError(null);
    try {
      const res = await fetch("/api/demo/exchange/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPii: disclosurePackage.encryptedPii,
          privateKey: exchangeKeypair.privateKey,
        }),
      });
      const data = await res.json();
      setDecryptedPii(data.pii);
      setStep("verification");
    } catch (error) {
      setFlowError(
        `Failed to decrypt PII: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setIsLoading(false);
  };

  // Step 4: Exchange verifies proofs
  const handleVerifyProofs = async () => {
    if (!disclosurePackage) return;
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
        livenessValid: disclosurePackage.livenessAttestation.verified,
      });
      setStep("summary");
    } catch (error) {
      setFlowError(
        `Failed to verify proofs: ${error instanceof Error ? error.message : String(error)}`,
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
        <h1 className="text-2xl font-bold">Exchange Simulator</h1>
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
            key={s}
            className={`h-2 flex-1 rounded ${
              step === s
                ? "bg-info"
                : i <
                    [
                      "intro",
                      "exchange-request",
                      "user-consent",
                      "disclosure",
                      "verification",
                      "summary",
                    ].indexOf(step)
                  ? "bg-success"
                  : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Current step */}
        <Card>
          <CardContent className="pt-6">
            {flowError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{flowError}</AlertDescription>
              </Alert>
            )}
            {step === "intro" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Welcome to the Exchange Demo
                </h2>
                <p className="text-muted-foreground mb-4">
                  This demo simulates a crypto exchange requesting KYC
                  verification from a Zentity user.
                </p>
                <div className="rounded border bg-muted/40 p-4 mb-4">
                  <h3 className="font-medium mb-2">The Flow:</h3>
                  <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                    <li>Exchange generates RSA keypair</li>
                    <li>User consents to share data</li>
                    <li>Zentity creates encrypted disclosure package</li>
                    <li>Exchange decrypts PII and verifies proofs</li>
                  </ol>
                </div>
                <Button
                  type="button"
                  onClick={handleGenerateKeypair}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? "Loading..." : "Start Demo as Exchange"}
                </Button>
              </div>
            )}

            {step === "exchange-request" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 1: Exchange Requests Verification
                </h2>
                <Alert variant="success" className="mb-4">
                  <AlertDescription>
                    Exchange keypair generated
                  </AlertDescription>
                </Alert>
                <div className="rounded border bg-muted/40 p-4 mb-4">
                  <h3 className="font-medium mb-2">Exchange Public Key:</h3>
                  <code className="text-xs text-muted-foreground break-all block">
                    {exchangeKeypair?.publicKey.substring(0, 100)}...
                  </code>
                </div>
                <p className="text-muted-foreground text-sm mb-4">
                  The exchange sends their public key to Zentity. PII will be
                  encrypted to this key.
                </p>
                <Button
                  type="button"
                  onClick={() => setStep("user-consent")}
                  className="w-full"
                >
                  Continue to User Consent
                </Button>
              </div>
            )}

            {step === "user-consent" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 2: User Consent
                </h2>
                <Alert variant="warning" className="mb-4">
                  <AlertTitle className="text-sm">Consent Request</AlertTitle>
                  <AlertDescription className="text-sm">
                    <strong>CryptoExchange Inc.</strong> is requesting access
                    to:
                  </AlertDescription>
                  <ul className="list-disc list-inside text-sm text-muted-foreground mt-2">
                    <li>Full Name</li>
                    <li>Date of Birth</li>
                    <li>Nationality</li>
                    <li>Document Number</li>
                    <li>Identity Verification Proofs</li>
                  </ul>
                </Alert>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    onClick={resetDemo}
                    variant="outline"
                    className="flex-1"
                  >
                    Deny
                  </Button>
                  <Button
                    type="button"
                    onClick={handleUserConsent}
                    disabled={isLoading}
                    className="flex-1"
                  >
                    {isLoading ? "Creating..." : "Approve"}
                  </Button>
                </div>
              </div>
            )}

            {step === "disclosure" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 3: Disclosure Package Created
                </h2>
                <Alert variant="success" className="mb-4">
                  <AlertDescription>
                    Package created and encrypted
                  </AlertDescription>
                </Alert>
                <div className="rounded border bg-muted/40 p-4 mb-4 space-y-2">
                  <div>
                    <span className="text-muted-foreground text-sm">
                      Encrypted PII:
                    </span>
                    <code className="text-xs text-info block truncate">
                      {disclosurePackage?.encryptedPii.encryptedData.substring(
                        0,
                        50,
                      )}
                      ...
                    </code>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-sm">
                      Proofs included:
                    </span>
                    <div className="flex gap-2 mt-1">
                      {disclosurePackage?.proofs.ageProof && (
                        <Badge variant="info" className="text-xs">
                          Age
                        </Badge>
                      )}
                      {disclosurePackage?.proofs.faceMatchProof && (
                        <Badge variant="info" className="text-xs">
                          Face Match
                        </Badge>
                      )}
                      {disclosurePackage?.proofs.docValidityProof && (
                        <Badge variant="info" className="text-xs">
                          Doc Validity
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleDecryptPii}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? "Decrypting..." : "Exchange: Decrypt PII"}
                </Button>
              </div>
            )}

            {step === "verification" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 4: Verify Proofs
                </h2>
                <Alert variant="success" className="mb-4">
                  <AlertDescription>
                    PII decrypted successfully
                  </AlertDescription>
                </Alert>
                <div className="rounded border bg-muted/40 p-4 mb-4">
                  <h3 className="font-medium mb-2">Decrypted PII:</h3>
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
                  type="button"
                  onClick={handleVerifyProofs}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? "Verifying..." : "Verify ZK Proofs"}
                </Button>
              </div>
            )}

            {step === "summary" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Verification Complete
                </h2>
                {hasAnyFailure ? (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                      One or more verifications failed
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="success" className="mb-4">
                    <AlertDescription>
                      All verifications passed
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2 mb-4">
                  {[
                    { label: "Age Proof", status: ageStatus },
                    { label: "Face Match Proof", status: faceMatchStatus },
                    {
                      label: "Document Validity Proof",
                      status: docValidityStatus,
                    },
                    { label: "Liveness Attestation", status: livenessStatus },
                  ].map(({ label, status }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded-full ${
                          status === undefined
                            ? "bg-muted"
                            : status
                              ? "bg-success"
                              : "bg-destructive"
                        }`}
                      />
                      <span>
                        {label}:{" "}
                        {status === undefined
                          ? "N/A"
                          : status
                            ? "Valid"
                            : "Invalid"}
                      </span>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={resetDemo}
                  variant="outline"
                  className="w-full"
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
              <h3 className="font-medium text-info mb-2">Zentity Stores:</h3>
              <div className="rounded border bg-muted/40 p-3 text-sm space-y-1">
                <p className="text-success">
                  SHA256(name + salt){" "}
                  <span className="text-muted-foreground">commitment</span>
                </p>
                <p className="text-success">
                  SHA256(doc_number + salt){" "}
                  <span className="text-muted-foreground">commitment</span>
                </p>
                <p className="text-success">
                  FHE(birth_year){" "}
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
              </div>
            </div>

            {/* Exchange */}
            <div>
              <h3 className="font-medium text-info mb-2">
                Exchange Receives & Stores:
              </h3>
              <div className="rounded border bg-muted/40 p-3 text-sm space-y-1">
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
                  <span className="text-muted-foreground">never disclosed</span>
                </p>
              </div>
            </div>

            {/* Key insight */}
            <div className="border border-info/30 bg-info/10 rounded p-4">
              <h3 className="font-medium text-info mb-2">Key Privacy Wins:</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Biometrics never leave Zentity</li>
                <li>Zentity never stores actual PII long-term</li>
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

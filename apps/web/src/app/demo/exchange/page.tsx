"use client";

/**
 * Exchange Simulator Demo
 *
 * Demonstrates the two-tier architecture for regulated entities:
 * 1. User completes verification on Zentity
 * 2. Exchange requests disclosure via user consent
 * 3. Exchange receives E2E encrypted PII + ZK proofs
 * 4. Exchange verifies proofs and decrypts PII
 *
 * Shows clearly what each party stores vs receives.
 */

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getStoredProfile } from "@/lib/privacy/secrets/profile";
import {
  generateAgeProof,
  generateDocValidityProof,
  generateFaceMatchProof,
  getProofChallenge,
  getSignedClaims,
} from "@/lib/privacy/zk/client";

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

function getStatusIndicatorClass(status: boolean | undefined): string {
  if (status === undefined) {
    return "bg-muted";
  }
  return status ? "bg-success" : "bg-destructive";
}

function getStatusLabel(status: boolean | undefined): string {
  if (status === undefined) {
    return "N/A";
  }
  return status ? "Valid" : "Invalid";
}

function VerificationStatusRow({
  label,
  status,
}: Readonly<{
  label: string;
  status: boolean | undefined;
}>) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-4 w-4 rounded-full ${getStatusIndicatorClass(status)}`}
      />
      <span>
        {label}: {getStatusLabel(status)}
      </span>
    </div>
  );
}

export default function ExchangeSimulatorPage() {
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
  const noirIsolationWarningRef = useRef(false);

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
      const now = new Date();
      const currentDateInt =
        now.getFullYear() * 10_000 + (now.getMonth() + 1) * 100 + now.getDate();
      const claims = await getSignedClaims();
      if (!(claims.ocr && claims.faceMatch)) {
        setFlowError("Missing signed claims for demo proofs");
        return;
      }

      const ocrData = claims.ocr.data as {
        claimHashes?: {
          age?: string | null;
          docValidity?: string | null;
        };
      };
      const profile = await getStoredProfile();
      const dateOfBirth = profile?.dateOfBirth ?? null;
      const expiryDate = profile?.expiryDateInt ?? null;
      const faceData = claims.faceMatch.data as {
        confidence?: number;
        confidenceFixed?: number;
        thresholdFixed?: number;
        claimHash?: string | null;
      };

      const documentHashField = claims.ocr.documentHashField;
      const ageClaimHash = ocrData.claimHashes?.age;
      const docClaimHash = ocrData.claimHashes?.docValidity;
      const faceClaimHash = faceData.claimHash;

      if (
        !documentHashField ||
        typeof dateOfBirth !== "string" ||
        typeof expiryDate !== "number" ||
        !ageClaimHash ||
        !docClaimHash ||
        !faceClaimHash
      ) {
        setFlowError("Incomplete OCR/face match claims for demo proofs");
        return;
      }

      const similarityFixed = ((): number | null => {
        if (typeof faceData.confidenceFixed === "number") {
          return faceData.confidenceFixed;
        }
        if (typeof faceData.confidence === "number") {
          return Math.round(faceData.confidence * 10_000);
        }
        return null;
      })();
      const thresholdFixed =
        typeof faceData.thresholdFixed === "number"
          ? faceData.thresholdFixed
          : Math.round(0.6 * 10_000);
      if (similarityFixed === null) {
        setFlowError("Missing face match score for demo proofs");
        return;
      }
      if (!noirIsolationWarningRef.current) {
        const isIsolated = globalThis.window?.crossOriginIsolated === true;
        if (!isIsolated) {
          noirIsolationWarningRef.current = true;
          toast.warning("ZK proofs may be slower in this session", {
            description:
              "Your browser is not cross-origin isolated, so multi-threaded proving is disabled. Proofs may take longer.",
          });
        }
      }

      const [ageChallenge, faceChallenge, docChallenge] = await Promise.all([
        getProofChallenge("age_verification"),
        getProofChallenge("face_match"),
        getProofChallenge("doc_validity"),
      ]);
      const results = await Promise.allSettled([
        generateAgeProof(dateOfBirth, 18, {
          nonce: ageChallenge.nonce,
          documentHashField,
          claimHash: ageClaimHash,
        }),
        generateFaceMatchProof(similarityFixed, thresholdFixed, {
          nonce: faceChallenge.nonce,
          documentHashField,
          claimHash: faceClaimHash,
        }),
        generateDocValidityProof(expiryDate, currentDateInt, {
          nonce: docChallenge.nonce,
          documentHashField,
          claimHash: docClaimHash,
        }),
      ]);

      const [ageProof, faceMatchProof, docValidityProof] = results;
      if (
        ageProof.status !== "fulfilled" ||
        faceMatchProof.status !== "fulfilled" ||
        docValidityProof.status !== "fulfilled"
      ) {
        const formatRejection = (reason: unknown): string =>
          reason instanceof Error ? reason.message : String(reason);

        const details = [
          ageProof.status === "rejected"
            ? `age: ${formatRejection(ageProof.reason)}`
            : null,
          faceMatchProof.status === "rejected"
            ? `face_match: ${formatRejection(faceMatchProof.reason)}`
            : null,
          docValidityProof.status === "rejected"
            ? `doc_validity: ${formatRejection(docValidityProof.reason)}`
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
          encryptedPii: disclosurePackage.encryptedPii,
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
        livenessValid: disclosurePackage.livenessAttestation.verified,
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
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 font-bold text-3xl">Exchange Simulator Demo</h1>
        <p className="mb-8 text-muted-foreground">
          Demonstrates privacy-preserving identity verification for regulated
          entities
        </p>

        {/* Progress indicator */}
        <div className="mb-8 flex gap-2">
          {[
            "intro",
            "exchange-request",
            "user-consent",
            "disclosure",
            "verification",
            "summary",
          ].map((s, i) => {
            const stepOrder = [
              "intro",
              "exchange-request",
              "user-consent",
              "disclosure",
              "verification",
              "summary",
            ];
            const currentStepIndex = stepOrder.indexOf(step);
            let progressClass = "bg-muted";
            if (step === s) {
              progressClass = "bg-info";
            } else if (i < currentStepIndex) {
              progressClass = "bg-success";
            }
            return (
              <div className={`h-2 flex-1 rounded ${progressClass}`} key={s} />
            );
          })}
        </div>

        {/* Step content */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Left: Current step */}
          <div className="rounded-lg border bg-card p-6">
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
                  This demo simulates a crypto exchange (like Binance or
                  Coinbase) requesting identity verification from a Zentity
                  user.
                </p>
                <div className="mb-4 rounded border bg-muted/40 p-4">
                  <h3 className="mb-2 font-medium">The Flow:</h3>
                  <ol className="list-inside list-decimal space-y-1 text-muted-foreground text-sm">
                    <li>Exchange generates RSA keypair</li>
                    <li>User consents to share data</li>
                    <li>Zentity creates encrypted disclosure package</li>
                    <li>Exchange decrypts PII and verifies proofs</li>
                  </ol>
                </div>
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
                <div className="mb-4 rounded border bg-muted/40 p-4">
                  <h3 className="mb-2 font-medium">Exchange Public Key:</h3>
                  <code className="block break-all text-muted-foreground text-xs">
                    {exchangeKeypair?.publicKey.substring(0, 100)}…
                  </code>
                </div>
                <p className="mb-4 text-muted-foreground text-sm">
                  The exchange sends their public key to Zentity. PII will be
                  encrypted to this key.
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
                      {disclosurePackage?.encryptedPii.encryptedData.substring(
                        0,
                        50
                      )}
                      …
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
                <div className="mb-4 rounded border bg-muted/40 p-4">
                  <h3 className="mb-2 font-medium">Decrypted PII:</h3>
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
                  <VerificationStatusRow label="Age Proof" status={ageStatus} />
                  <VerificationStatusRow
                    label="Face Match Proof"
                    status={faceMatchStatus}
                  />
                  <VerificationStatusRow
                    label="Document Validity Proof"
                    status={docValidityStatus}
                  />
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-4 w-4 rounded-full ${
                        livenessStatus ? "bg-success" : "bg-destructive"
                      }`}
                    />
                    <span>
                      Liveness Attestation:{" "}
                      {livenessStatus ? "Verified" : "Failed"}
                    </span>
                  </div>
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
          </div>

          {/* Right: Data storage comparison */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-4 font-semibold text-xl">
              What Each Party Stores
            </h2>

            <div className="space-y-6">
              {/* Zentity */}
              <div>
                <h3 className="mb-2 font-medium text-info">Zentity Stores:</h3>
                <div className="space-y-1 rounded border bg-muted/40 p-3 text-sm">
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
                  <p className="text-success">
                    verification_status{" "}
                    <span className="text-muted-foreground">boolean flags</span>
                  </p>
                  <p className="text-destructive line-through">
                    Document image{" "}
                    <span className="text-muted-foreground">never stored</span>
                  </p>
                  <p className="text-destructive line-through">
                    Face embeddings{" "}
                    <span className="text-muted-foreground">never stored</span>
                  </p>
                  <p className="text-destructive line-through">
                    Actual name/DOB{" "}
                    <span className="text-muted-foreground">
                      never stored in plaintext
                    </span>
                  </p>
                </div>
              </div>

              {/* Exchange */}
              <div>
                <h3 className="mb-2 font-medium text-info">
                  Exchange Receives & Stores:
                </h3>
                <div className="space-y-1 rounded border bg-muted/40 p-3 text-sm">
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
                  <p className="text-warning">
                    Document Number{" "}
                    <span className="text-muted-foreground">
                      required in some jurisdictions
                    </span>
                  </p>
                  <p className="text-success">
                    ZK Proofs{" "}
                    <span className="text-muted-foreground">
                      cryptographic verification
                    </span>
                  </p>
                  <p className="text-success">
                    Liveness Attestation{" "}
                    <span className="text-muted-foreground">
                      signed statement
                    </span>
                  </p>
                  <p className="text-destructive line-through">
                    Biometrics{" "}
                    <span className="text-muted-foreground">
                      never disclosed
                    </span>
                  </p>
                  <p className="text-destructive line-through">
                    Face embeddings{" "}
                    <span className="text-muted-foreground">
                      never disclosed
                    </span>
                  </p>
                </div>
              </div>

              {/* Key insight */}
              <div className="rounded border border-info/30 bg-info/10 p-4">
                <h3 className="mb-2 font-medium text-info">
                  Key Privacy Wins:
                </h3>
                <ul className="space-y-1 text-muted-foreground text-sm">
                  <li>Biometrics never leave Zentity</li>
                  <li>Zentity never stores plaintext PII long-term</li>
                  <li>Exchange gets regulatory compliance</li>
                  <li>ZK proofs provide cryptographic assurance</li>
                  <li>Liability is minimized for both parties</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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

import { useState } from "react";

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
          ageProof.status === "rejected"
            ? `age: ${ageProof.reason instanceof Error ? ageProof.reason.message : String(ageProof.reason)}`
            : null,
          faceMatchProof.status === "rejected"
            ? `face_match: ${faceMatchProof.reason instanceof Error ? faceMatchProof.reason.message : String(faceMatchProof.reason)}`
            : null,
          docValidityProof.status === "rejected"
            ? `doc_validity: ${docValidityProof.reason instanceof Error ? docValidityProof.reason.message : String(docValidityProof.reason)}`
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
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Exchange Simulator Demo</h1>
        <p className="text-gray-400 mb-8">
          Demonstrates privacy-preserving identity verification for regulated
          entities
        </p>

        {/* Progress indicator */}
        <div className="flex gap-2 mb-8">
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
                  ? "bg-blue-500"
                  : i <
                      [
                        "intro",
                        "exchange-request",
                        "user-consent",
                        "disclosure",
                        "verification",
                        "summary",
                      ].indexOf(step)
                    ? "bg-green-500"
                    : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Current step */}
          <div className="bg-gray-800 rounded-lg p-6">
            {flowError && (
              <div className="mb-4 rounded border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">
                {flowError}
              </div>
            )}
            {step === "intro" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Welcome to the Exchange Demo
                </h2>
                <p className="text-gray-300 mb-4">
                  This demo simulates a crypto exchange (like Binance or
                  Coinbase) requesting KYC verification from a Zentity user.
                </p>
                <div className="bg-gray-700 rounded p-4 mb-4">
                  <h3 className="font-medium mb-2">The Flow:</h3>
                  <ol className="list-decimal list-inside text-sm text-gray-300 space-y-1">
                    <li>Exchange generates RSA keypair</li>
                    <li>User consents to share data</li>
                    <li>Zentity creates encrypted disclosure package</li>
                    <li>Exchange decrypts PII and verifies proofs</li>
                  </ol>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateKeypair}
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-medium disabled:opacity-50"
                >
                  {isLoading ? "Loading..." : "Start Demo as Exchange"}
                </button>
              </div>
            )}

            {step === "exchange-request" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 1: Exchange Requests Verification
                </h2>
                <div className="bg-green-900/30 border border-green-700 rounded p-4 mb-4">
                  <p className="text-green-400 text-sm">
                    Exchange keypair generated
                  </p>
                </div>
                <div className="bg-gray-700 rounded p-4 mb-4">
                  <h3 className="font-medium mb-2">Exchange Public Key:</h3>
                  <code className="text-xs text-gray-400 break-all block">
                    {exchangeKeypair?.publicKey.substring(0, 100)}...
                  </code>
                </div>
                <p className="text-gray-300 text-sm mb-4">
                  The exchange sends their public key to Zentity. PII will be
                  encrypted to this key.
                </p>
                <button
                  type="button"
                  onClick={() => setStep("user-consent")}
                  className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-medium"
                >
                  Continue to User Consent
                </button>
              </div>
            )}

            {step === "user-consent" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 2: User Consent
                </h2>
                <div className="bg-yellow-900/30 border border-yellow-700 rounded p-4 mb-4">
                  <h3 className="font-medium text-yellow-400 mb-2">
                    Consent Request
                  </h3>
                  <p className="text-sm text-gray-300">
                    <strong>CryptoExchange Inc.</strong> is requesting access
                    to:
                  </p>
                  <ul className="list-disc list-inside text-sm text-gray-300 mt-2">
                    <li>Full Name</li>
                    <li>Date of Birth</li>
                    <li>Nationality</li>
                    <li>Document Number</li>
                    <li>Identity Verification Proofs</li>
                  </ul>
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={resetDemo}
                    className="flex-1 bg-gray-600 hover:bg-gray-700 px-4 py-3 rounded font-medium"
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    onClick={handleUserConsent}
                    disabled={isLoading}
                    className="flex-1 bg-green-600 hover:bg-green-700 px-4 py-3 rounded font-medium disabled:opacity-50"
                  >
                    {isLoading ? "Creating..." : "Approve"}
                  </button>
                </div>
              </div>
            )}

            {step === "disclosure" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 3: Disclosure Package Created
                </h2>
                <div className="bg-green-900/30 border border-green-700 rounded p-4 mb-4">
                  <p className="text-green-400 text-sm">
                    Package created and encrypted
                  </p>
                </div>
                <div className="bg-gray-700 rounded p-4 mb-4 space-y-2">
                  <div>
                    <span className="text-gray-400 text-sm">
                      Encrypted PII:
                    </span>
                    <code className="text-xs text-blue-400 block truncate">
                      {disclosurePackage?.encryptedPii.encryptedData.substring(
                        0,
                        50,
                      )}
                      ...
                    </code>
                  </div>
                  <div>
                    <span className="text-gray-400 text-sm">
                      Proofs included:
                    </span>
                    <div className="flex gap-2 mt-1">
                      {disclosurePackage?.proofs.ageProof && (
                        <span className="bg-purple-900/50 text-purple-300 text-xs px-2 py-1 rounded">
                          Age
                        </span>
                      )}
                      {disclosurePackage?.proofs.faceMatchProof && (
                        <span className="bg-purple-900/50 text-purple-300 text-xs px-2 py-1 rounded">
                          Face Match
                        </span>
                      )}
                      {disclosurePackage?.proofs.docValidityProof && (
                        <span className="bg-purple-900/50 text-purple-300 text-xs px-2 py-1 rounded">
                          Doc Validity
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDecryptPii}
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-medium disabled:opacity-50"
                >
                  {isLoading ? "Decrypting..." : "Exchange: Decrypt PII"}
                </button>
              </div>
            )}

            {step === "verification" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Step 4: Verify Proofs
                </h2>
                <div className="bg-green-900/30 border border-green-700 rounded p-4 mb-4">
                  <p className="text-green-400 text-sm">
                    PII decrypted successfully
                  </p>
                </div>
                <div className="bg-gray-700 rounded p-4 mb-4">
                  <h3 className="font-medium mb-2">Decrypted PII:</h3>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-gray-400">Name:</span>{" "}
                      {decryptedPii?.fullName}
                    </p>
                    <p>
                      <span className="text-gray-400">DOB:</span>{" "}
                      {decryptedPii?.dateOfBirth}
                    </p>
                    <p>
                      <span className="text-gray-400">Nationality:</span>{" "}
                      {decryptedPii?.nationality}
                    </p>
                    <p>
                      <span className="text-gray-400">Document:</span>{" "}
                      {decryptedPii?.documentNumber}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleVerifyProofs}
                  disabled={isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-medium disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify ZK Proofs"}
                </button>
              </div>
            )}

            {step === "summary" && (
              <div>
                <h2 className="text-xl font-semibold mb-4">
                  Verification Complete
                </h2>
                {hasAnyFailure ? (
                  <div className="bg-red-900/30 border border-red-700 rounded p-4 mb-4">
                    <p className="text-red-400 font-medium">
                      One or more verifications failed
                    </p>
                  </div>
                ) : (
                  <div className="bg-green-900/30 border border-green-700 rounded p-4 mb-4">
                    <p className="text-green-400 font-medium">
                      All verifications passed
                    </p>
                  </div>
                )}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full ${
                        ageStatus === undefined
                          ? "bg-gray-500"
                          : ageStatus
                            ? "bg-green-500"
                            : "bg-red-500"
                      }`}
                    />
                    <span>
                      Age Proof:{" "}
                      {ageStatus === undefined
                        ? "N/A"
                        : ageStatus
                          ? "Valid"
                          : "Invalid"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full ${
                        faceMatchStatus === undefined
                          ? "bg-gray-500"
                          : faceMatchStatus
                            ? "bg-green-500"
                            : "bg-red-500"
                      }`}
                    />
                    <span>
                      Face Match Proof:{" "}
                      {faceMatchStatus === undefined
                        ? "N/A"
                        : faceMatchStatus
                          ? "Valid"
                          : "Invalid"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full ${
                        docValidityStatus === undefined
                          ? "bg-gray-500"
                          : docValidityStatus
                            ? "bg-green-500"
                            : "bg-red-500"
                      }`}
                    />
                    <span>
                      Document Validity Proof:{" "}
                      {docValidityStatus === undefined
                        ? "N/A"
                        : docValidityStatus
                          ? "Valid"
                          : "Invalid"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full ${
                        livenessStatus ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span>
                      Liveness Attestation:{" "}
                      {livenessStatus ? "Verified" : "Failed"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetDemo}
                  className="w-full bg-gray-600 hover:bg-gray-700 px-4 py-3 rounded font-medium"
                >
                  Restart Demo
                </button>
              </div>
            )}
          </div>

          {/* Right: Data storage comparison */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">
              What Each Party Stores
            </h2>

            <div className="space-y-6">
              {/* Zentity */}
              <div>
                <h3 className="font-medium text-blue-400 mb-2">
                  Zentity Stores:
                </h3>
                <div className="bg-gray-700 rounded p-3 text-sm space-y-1">
                  <p className="text-green-400">
                    SHA256(name + salt){" "}
                    <span className="text-gray-500">commitment</span>
                  </p>
                  <p className="text-green-400">
                    SHA256(doc_number + salt){" "}
                    <span className="text-gray-500">commitment</span>
                  </p>
                  <p className="text-green-400">
                    FHE(birth_year){" "}
                    <span className="text-gray-500">encrypted</span>
                  </p>
                  <p className="text-green-400">
                    user_salt{" "}
                    <span className="text-gray-500">used for GDPR erasure</span>
                  </p>
                  <p className="text-green-400">
                    verification_status{" "}
                    <span className="text-gray-500">boolean flags</span>
                  </p>
                  <p className="text-red-400 line-through">
                    Document image{" "}
                    <span className="text-gray-500">never stored</span>
                  </p>
                  <p className="text-red-400 line-through">
                    Face embeddings{" "}
                    <span className="text-gray-500">never stored</span>
                  </p>
                  <p className="text-red-400 line-through">
                    Actual name/DOB{" "}
                    <span className="text-gray-500">never stored</span>
                  </p>
                </div>
              </div>

              {/* Exchange */}
              <div>
                <h3 className="font-medium text-purple-400 mb-2">
                  Exchange Receives & Stores:
                </h3>
                <div className="bg-gray-700 rounded p-3 text-sm space-y-1">
                  <p className="text-yellow-400">
                    Full Name{" "}
                    <span className="text-gray-500">
                      regulatory requirement
                    </span>
                  </p>
                  <p className="text-yellow-400">
                    Date of Birth{" "}
                    <span className="text-gray-500">
                      regulatory requirement
                    </span>
                  </p>
                  <p className="text-yellow-400">
                    Nationality{" "}
                    <span className="text-gray-500">
                      regulatory requirement
                    </span>
                  </p>
                  <p className="text-yellow-400">
                    Document Number{" "}
                    <span className="text-gray-500">
                      required in some jurisdictions
                    </span>
                  </p>
                  <p className="text-green-400">
                    ZK Proofs{" "}
                    <span className="text-gray-500">
                      cryptographic verification
                    </span>
                  </p>
                  <p className="text-green-400">
                    Liveness Attestation{" "}
                    <span className="text-gray-500">signed statement</span>
                  </p>
                  <p className="text-red-400 line-through">
                    Biometrics{" "}
                    <span className="text-gray-500">never disclosed</span>
                  </p>
                  <p className="text-red-400 line-through">
                    Face embeddings{" "}
                    <span className="text-gray-500">never disclosed</span>
                  </p>
                </div>
              </div>

              {/* Key insight */}
              <div className="bg-blue-900/30 border border-blue-700 rounded p-4">
                <h3 className="font-medium text-blue-400 mb-2">
                  Key Privacy Wins:
                </h3>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>Biometrics never leave Zentity</li>
                  <li>Zentity never stores actual PII long-term</li>
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

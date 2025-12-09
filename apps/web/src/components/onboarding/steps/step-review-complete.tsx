"use client";

/* eslint @next/next/no-img-element: off */

import { useForm } from "@tanstack/react-form";
import {
  ArrowLeftRight,
  Check,
  Database,
  Edit2,
  Key,
  Loader2,
  Lock,
  Shield,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Field,
  FieldControl,
  FieldLabel,
  FieldMessage,
} from "@/components/ui/tanstack-form";
import { passwordSchema } from "@/features/auth/schemas/sign-up.schema";
import { trackFaceMatch } from "@/lib/analytics";
import { signUp } from "@/lib/auth-client";
import {
  encryptDOB,
  generateAgeProof,
  storeAgeProof,
  verifyAgeProof,
} from "@/lib/crypto-client";
import { type FaceMatchResult, matchFaces } from "@/lib/face-detection";
import { cn } from "@/lib/utils";
import { makeFieldValidator } from "@/lib/validation";
import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

type ProofStatus =
  | "idle"
  | "creating-account"
  | "encrypting"
  | "generating"
  | "verifying"
  | "verifying-identity"
  | "storing"
  | "complete"
  | "error";

interface StepIndicatorProps {
  label: string;
  status: "pending" | "active" | "complete" | "skipped";
  icon: React.ReactNode;
}

function StepIndicator({ label, status, icon }: StepIndicatorProps) {
  if (status === "skipped") {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full transition-all",
          status === "complete" && "bg-green-600 text-white",
          status === "active" && "bg-blue-600 text-white animate-pulse",
          status === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        {status === "complete" ? (
          <Check className="h-4 w-4" />
        ) : status === "active" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          icon
        )}
      </div>
      <span
        className={cn(
          "text-sm transition-colors",
          status === "complete" && "text-green-600 font-medium",
          status === "active" && "text-blue-600 font-medium",
          status === "pending" && "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

type FaceMatchStatus = "idle" | "matching" | "matched" | "no_match" | "error";

/**
 * Step 4: Review & Complete
 *
 * - Display extracted data from document for review
 * - Allow editing if OCR was wrong
 * - Collect password
 * - Create account after all verification is complete
 */
export function StepReviewComplete() {
  const router = useRouter();
  const { state, updateData, setSubmitting, reset } = useWizard();
  const { data } = state;
  const [error, setError] = useState<string | null>(null);
  const [proofStatus, setProofStatus] = useState<ProofStatus>("idle");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.extractedName || "");

  // Face matching state
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);

  // Password form with TanStack Form
  const form = useForm({
    defaultValues: {
      password: data.password || "",
      confirmPassword: data.confirmPassword || "",
    },
    onSubmit: async ({ value }) => {
      await handleSubmit(value);
    },
  });

  // Validate password field
  const validatePassword = makeFieldValidator(
    passwordSchema,
    "password",
    (value: string) => ({
      password: value,
      confirmPassword: form.getFieldValue("confirmPassword"),
    }),
  );

  // Validate confirm password field (includes cross-field validation)
  const validateConfirmPassword = makeFieldValidator(
    passwordSchema,
    "confirmPassword",
    (value: string) => ({
      password: form.getFieldValue("password"),
      confirmPassword: value,
    }),
  );

  const calculateAge = (dob: string | null): number | null => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  };

  const getBirthYear = (dob: string | null): number | null => {
    if (!dob) return null;
    const date = new Date(dob);
    if (Number.isNaN(date.getTime())) return null;
    return date.getFullYear();
  };

  // Get the best selfie frame for face matching (or fall back to the regular selfie)
  const selfieForMatching = data.bestSelfieFrame || data.selfieImage;

  // Auto-trigger face matching when both ID and selfie are available
  useEffect(() => {
    const performFaceMatch = async () => {
      if (!data.idDocumentBase64 || !selfieForMatching) return;

      setFaceMatchStatus("matching");
      try {
        const result = await matchFaces(
          data.idDocumentBase64,
          selfieForMatching,
        );
        setFaceMatchResult(result);

        if (result.error) {
          setFaceMatchStatus("error");
          trackFaceMatch("error", { error: result.error });
        } else if (result.matched) {
          setFaceMatchStatus("matched");
          trackFaceMatch("matched", { confidence: result.confidence });
        } else {
          setFaceMatchStatus("no_match");
          trackFaceMatch("no_match", { confidence: result.confidence });
        }
      } catch (err) {
        setFaceMatchStatus("error");
        setFaceMatchResult({
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: 0.6,
          processingTimeMs: 0,
          idFaceExtracted: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
        trackFaceMatch("error", {
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    };

    if (
      data.idDocumentBase64 &&
      selfieForMatching &&
      faceMatchStatus === "idle"
    ) {
      performFaceMatch();
    }
  }, [data.idDocumentBase64, selfieForMatching, faceMatchStatus]);

  const handleSubmit = async (formData: {
    password: string;
    confirmPassword: string;
  }) => {
    // Validate the full schema before proceeding
    const validation = passwordSchema.safeParse(formData);
    if (!validation.success) {
      toast.error("Validation failed", {
        description:
          validation.error.issues[0]?.message || "Please check your password",
      });
      return;
    }

    // Save password to wizard state
    updateData({
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    });

    setSubmitting(true);
    setError(null);

    try {
      // Use extracted name or edited name, fallback to email prefix
      const accountName =
        editedName || data.extractedName || data.email.split("@")[0];

      // Get birth year from extracted DOB
      const birthYear = getBirthYear(data.extractedDOB);

      // Variables to hold crypto results (generated BEFORE account creation)
      let fheResult: {
        ciphertext: string;
        clientKeyId: string;
        encryptionTimeMs: number;
      } | null = null;
      let proofResult: {
        proof: object;
        publicSignals: string[];
        generationTimeMs: number;
      } | null = null;

      // If we have DOB, we MUST generate proofs BEFORE creating account
      // This is critical: DOB is extracted from document which is NOT stored
      // If we create account without proofs, we lose the DOB forever
      if (birthYear) {
        const currentYear = new Date().getFullYear();

        // Encrypt DOB with FHE (for future homomorphic computations)
        setProofStatus("encrypting");
        try {
          fheResult = await encryptDOB(birthYear);
        } catch (_fheError) {}

        // Generate ZK proof of age (privacy-preserving) - THIS IS REQUIRED
        setProofStatus("generating");
        try {
          proofResult = await generateAgeProof(birthYear, currentYear, 18);
        } catch (_zkError) {
          setError(
            "Privacy verification services are temporarily unavailable. " +
              "Your information has not been stored. Please try again in a few minutes.",
          );
          setProofStatus("error");
          setSubmitting(false);
          return;
        }

        // Verify the proof locally to ensure it's valid
        setProofStatus("verifying");
        const verifyResult = await verifyAgeProof(
          proofResult.proof,
          proofResult.publicSignals,
        );

        if (!verifyResult.isValid) {
          setError("Age verification failed. Please try again.");
          setProofStatus("error");
          setSubmitting(false);
          return;
        }
      }

      // NOW create the account (only after proofs are ready)
      setProofStatus("creating-account");
      const result = await signUp.email({
        email: data.email,
        password: formData.password,
        name: accountName,
      });

      if (result.error) {
        setError(result.error.message || "Failed to create account");
        setProofStatus("error");
        setSubmitting(false);
        return;
      }

      // Full identity verification (document + liveness + face matching)
      // Use the same selfie that was used for local face matching (bestSelfieFrame or fallback to selfieImage)
      const selfieToVerify = data.bestSelfieFrame || data.selfieImage;
      if (data.idDocumentBase64 && selfieToVerify) {
        setProofStatus("verifying-identity");
        try {
          const identityResponse = await fetch("/api/identity/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              documentImage: data.idDocumentBase64,
              selfieImage: selfieToVerify,
              // Pass local face match result for comparison/logging
              localFaceMatch: faceMatchResult
                ? {
                    matched: faceMatchResult.matched,
                    confidence: faceMatchResult.confidence,
                  }
                : undefined,
            }),
          });

          if (!identityResponse.ok) {
            const _errorData = await identityResponse.json();
          } else {
            const identityResult = await identityResponse.json();
            if (!identityResult.verified) {
            }
          }
        } catch (_identityError) {}
      }

      // Store the proof AND FHE ciphertext
      if (proofResult) {
        setProofStatus("storing");
        await storeAgeProof(
          proofResult.proof,
          proofResult.publicSignals,
          true,
          proofResult.generationTimeMs,
          fheResult
            ? {
                dobCiphertext: fheResult.ciphertext,
                fheClientKeyId: fheResult.clientKeyId,
                fheEncryptionTimeMs: fheResult.encryptionTimeMs,
              }
            : undefined,
        );
      }

      setProofStatus("complete");
      reset();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again.",
      );
      setProofStatus("error");
      setSubmitting(false);
    }
  };

  const hasIdentityDocs = Boolean(
    data.idDocumentBase64 && (data.bestSelfieFrame || data.selfieImage),
  );
  const hasDOB = Boolean(data.extractedDOB);

  const getStepStatus = (
    step: "account" | "encrypt" | "proof" | "verify" | "identity" | "store",
  ): "pending" | "active" | "complete" | "skipped" => {
    const statusOrder: ProofStatus[] = [
      "idle",
      "creating-account",
      "encrypting",
      "generating",
      "verifying",
      "verifying-identity",
      "storing",
      "complete",
    ];
    const currentIndex = statusOrder.indexOf(proofStatus);

    const stepIndices = {
      account: 1,
      encrypt: 2,
      proof: 3,
      verify: 4,
      identity: 5,
      store: 6,
    };

    // Skip identity step if no documents provided
    if (step === "identity" && !hasIdentityDocs) {
      return "skipped";
    }

    // Skip crypto steps if no DOB
    if (
      (step === "encrypt" ||
        step === "proof" ||
        step === "verify" ||
        step === "store") &&
      !hasDOB
    ) {
      return "skipped";
    }

    if (proofStatus === "error") return "pending";
    if (currentIndex > stepIndices[step]) return "complete";
    if (currentIndex === stepIndices[step]) return "active";
    return "pending";
  };

  const handleSaveName = () => {
    updateData({ extractedName: editedName || null });
    setIsEditingName(false);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Review & Complete</h3>
        <p className="text-sm text-muted-foreground">
          Review your information and create your password to complete
          registration.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => form.handleSubmit()}
              className="ml-4 text-sm font-medium underline hover:no-underline"
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Extracted Information Review */}
      <div className="space-y-4 rounded-lg border p-4">
        <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
          Your Information
        </h4>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Email</span>
          <span className="font-medium">{data.email}</span>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Name</span>
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="h-8 w-48"
                  placeholder="Enter name"
                />
                <Button size="sm" variant="ghost" onClick={handleSaveName}>
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <span className="font-medium">
                  {editedName || data.extractedName || "Not extracted"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditedName(data.extractedName || "");
                    setIsEditingName(true);
                  }}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Date of Birth</span>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {data.extractedDOB || "Not extracted"}
            </span>
            {calculateAge(data.extractedDOB) !== null && (
              <Badge variant="secondary">
                {calculateAge(data.extractedDOB)}+ years
              </Badge>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Nationality</span>
          <span className="font-medium">
            {data.extractedNationality || "Not extracted"}
          </span>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Document</span>
          <Badge variant={data.idDocument ? "default" : "outline"}>
            {data.idDocument ? "Uploaded" : "Skipped"}
          </Badge>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Liveness</span>
          <Badge variant={data.selfieImage ? "default" : "outline"}>
            {data.selfieImage ? "Verified" : "Skipped"}
          </Badge>
        </div>
      </div>

      {/* Face Matching UI */}
      {hasIdentityDocs && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Face Verification</span>
          </div>

          <div className="flex items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "w-20 h-20 rounded-lg overflow-hidden border bg-muted relative",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-blue-400 ring-offset-2",
                )}
              >
                {faceMatchStatus === "matching" &&
                  !faceMatchResult?.idFaceImage && (
                    <Skeleton className="h-full w-full" />
                  )}
                {(faceMatchResult?.idFaceImage || data.idDocumentBase64) && (
                  <img
                    src={
                      faceMatchResult?.idFaceImage ||
                      data.idDocumentBase64 ||
                      ""
                    }
                    alt="ID Photo"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70",
                    )}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground">ID Photo</span>
            </div>

            <div className="flex flex-col items-center gap-1">
              {faceMatchStatus === "idle" && (
                <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />
              )}
              {faceMatchStatus === "matching" && (
                <div className="flex flex-col items-center gap-1 animate-in fade-in duration-300">
                  <div className="relative">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                    <div className="absolute inset-0 h-6 w-6 rounded-full bg-blue-400/20 animate-ping" />
                  </div>
                  <Skeleton className="h-3 w-16 mt-1" />
                </div>
              )}
              {faceMatchStatus === "matched" && (
                <div className="animate-in zoom-in duration-300">
                  <Check className="h-6 w-6 text-green-600" />
                  <span className="text-xs font-medium text-green-600">
                    {Math.round((faceMatchResult?.confidence || 0) * 100)}%
                    match
                  </span>
                </div>
              )}
              {faceMatchStatus === "no_match" && (
                <>
                  <XCircle className="h-6 w-6 text-red-600" />
                  <span className="text-xs font-medium text-red-600">
                    No match
                  </span>
                </>
              )}
              {faceMatchStatus === "error" && (
                <>
                  <XCircle className="h-6 w-6 text-yellow-600" />
                  <span className="text-xs font-medium text-yellow-600">
                    Error
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "w-20 h-20 rounded-lg overflow-hidden border bg-muted relative",
                  faceMatchStatus === "matching" &&
                    "ring-2 ring-blue-400 ring-offset-2",
                )}
              >
                {faceMatchStatus === "matching" && !selfieForMatching && (
                  <Skeleton className="h-full w-full" />
                )}
                {selfieForMatching && (
                  <img
                    src={selfieForMatching}
                    alt="Selfie"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70",
                    )}
                  />
                )}
              </div>
              <span className="text-xs text-muted-foreground">Selfie</span>
            </div>
          </div>

          {faceMatchStatus === "matching" && (
            <p className="text-sm text-center text-muted-foreground">
              Comparing faces...
            </p>
          )}
          {faceMatchStatus === "matched" && (
            <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
              <Check className="h-4 w-4 text-green-600" />
              <AlertDescription className="ml-2 text-green-700 dark:text-green-300">
                Face verification successful. The selfie matches the ID
                document.
              </AlertDescription>
            </Alert>
          )}
          {faceMatchStatus === "no_match" && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="ml-2">
                The selfie does not match the ID document photo. You may
                proceed, but additional verification may be required.
              </AlertDescription>
            </Alert>
          )}
          {faceMatchStatus === "error" && (
            <Alert>
              <AlertDescription>
                Face verification could not be completed. You may proceed, but
                please ensure your ID and selfie are clear.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Password Form */}
      {proofStatus === "idle" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="rounded-lg border p-4 space-y-4">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
              Create Password
            </h4>

            <form.Field
              name="password"
              validators={{
                onBlur: ({ value }) => validatePassword(value),
                onSubmit: ({ value }) => validatePassword(value),
              }}
            >
              {(field) => (
                <Field
                  name={field.name}
                  errors={field.state.meta.errors as string[]}
                  isTouched={field.state.meta.isTouched}
                  isValidating={field.state.meta.isValidating}
                >
                  <FieldLabel>Password</FieldLabel>
                  <FieldControl>
                    <Input
                      type="password"
                      placeholder="Create a strong password"
                      autoComplete="new-password"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FieldControl>
                  <FieldMessage />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="confirmPassword"
              validators={{
                onBlur: ({ value }) => validateConfirmPassword(value),
                onSubmit: ({ value }) => validateConfirmPassword(value),
              }}
            >
              {(field) => (
                <Field
                  name={field.name}
                  errors={field.state.meta.errors as string[]}
                  isTouched={field.state.meta.isTouched}
                  isValidating={field.state.meta.isValidating}
                >
                  <FieldLabel>Confirm Password</FieldLabel>
                  <FieldControl>
                    <Input
                      type="password"
                      placeholder="Confirm your password"
                      autoComplete="new-password"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FieldControl>
                  <FieldMessage />
                </Field>
              )}
            </form.Field>

            <p className="text-xs text-muted-foreground">
              Password must be at least 8 characters with uppercase, lowercase,
              and a number.
            </p>
          </div>

          <WizardNavigation
            onNext={() => form.handleSubmit()}
            nextLabel="Complete Registration"
          />
        </form>
      )}

      {/* Processing Status */}
      {proofStatus !== "idle" && proofStatus !== "error" && (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-950 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <span className="font-medium text-blue-700 dark:text-blue-300">
              Securing your account
            </span>
          </div>

          <div className="space-y-3">
            <StepIndicator
              label="Creating account"
              status={getStepStatus("account")}
              icon={<Lock className="h-4 w-4" />}
            />
            <StepIndicator
              label="Encrypting data (FHE)"
              status={getStepStatus("encrypt")}
              icon={<Key className="h-4 w-4" />}
            />
            <StepIndicator
              label="Generating privacy proof (ZK)"
              status={getStepStatus("proof")}
              icon={<Shield className="h-4 w-4" />}
            />
            <StepIndicator
              label="Verifying proof"
              status={getStepStatus("verify")}
              icon={<Check className="h-4 w-4" />}
            />
            <StepIndicator
              label="Verifying identity (document + face)"
              status={getStepStatus("identity")}
              icon={<UserCheck className="h-4 w-4" />}
            />
            <StepIndicator
              label="Storing verification"
              status={getStepStatus("store")}
              icon={<Database className="h-4 w-4" />}
            />
          </div>

          <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-blue-200 dark:border-blue-800">
            Your personal data is processed transiently. Only cryptographic
            proofs are stored.
          </p>
        </div>
      )}

      {/* Privacy Info */}
      {proofStatus === "idle" && (
        <Alert>
          <AlertDescription>
            <strong>Privacy-First Verification:</strong>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
              {hasDOB && (
                <>
                  <li>
                    Your birth year is encrypted using FHE (Fully Homomorphic
                    Encryption)
                  </li>
                  <li>
                    A zero-knowledge proof verifies you are 18+ without
                    revealing your age
                  </li>
                </>
              )}
              {hasIdentityDocs && (
                <>
                  <li>
                    Your ID document is processed to generate cryptographic
                    commitments
                  </li>
                  <li>
                    Face matching compares your selfie to your ID photo, then
                    both are deleted
                  </li>
                </>
              )}
              <li>
                Only proofs and commitments are stored - all PII is deleted
                immediately
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {proofStatus === "idle" && (
        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">What we keep</p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground space-y-1">
              <li>Encrypted birth year (FHE) and a ZK proof you are 18+</li>
              <li>Document hash/commitment (no raw image)</li>
              <li>Face-match proof outcome (boolean + confidence)</li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">What we delete</p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground space-y-1">
              <li>Raw document image after commitments are derived</li>
              <li>Selfie frames after liveness + face match checks</li>
              <li>Intermediate model outputs and embeddings</li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium">Why</p>
            <p className="text-sm text-muted-foreground">
              You keep control of PII; we keep only the cryptographic evidence
              required to prove you&apos;re over 18 and matched to your
              document.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

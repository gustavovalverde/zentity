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
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PasswordRequirements } from "@/components/auth/password-requirements";
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
import {
  getBetterAuthErrorMessage,
  getPasswordLengthError,
  getPasswordPolicyErrorMessage,
  getPasswordSimilarityError,
  signUp,
} from "@/lib/auth";
import {
  encryptDOB,
  generateAgeProof,
  getProofChallenge,
  storeAgeProof,
} from "@/lib/crypto";
import {
  type FaceMatchResult,
  matchFaces,
} from "@/lib/liveness/face-detection";
import { trpc } from "@/lib/trpc/client";
import { cn, makeFieldValidator } from "@/lib/utils";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

type ProofStatus =
  | "idle"
  | "creating-account"
  | "encrypting"
  | "generating"
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
          status === "complete" && "bg-success text-success-foreground",
          status === "active" && "bg-info text-info-foreground animate-pulse",
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
          status === "complete" && "text-success font-medium",
          status === "active" && "text-info font-medium",
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
  const searchParams = useSearchParams();
  const { state, updateData, setSubmitting, reset } = useWizard();
  const { data } = state;
  const [error, setError] = useState<string | null>(null);
  const [proofStatus, setProofStatus] = useState<ProofStatus>("idle");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(data.extractedName || "");
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const [breachCheckKey, setBreachCheckKey] = useState(0);
  const [breachStatus, setBreachStatus] = useState<
    "idle" | "checking" | "safe" | "compromised" | "error"
  >("idle");
  const [breachCheckedPassword, setBreachCheckedPassword] = useState<
    string | null
  >(null);

  // Face matching state
  const [faceMatchStatus, setFaceMatchStatus] =
    useState<FaceMatchStatus>("idle");
  const [faceMatchResult, setFaceMatchResult] =
    useState<FaceMatchResult | null>(null);
  // Prevent duplicate face matching attempts
  const faceMatchAttemptedRef = useRef(false);

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

  const validatePasswordSchema = makeFieldValidator(
    passwordSchema,
    "password",
    (value: string) => ({
      password: value,
      confirmPassword: form.getFieldValue("confirmPassword"),
    }),
  );

  const validatePassword = (value: string) => {
    const schemaError = validatePasswordSchema(value);
    if (schemaError) return schemaError;
    return getPasswordSimilarityError(value, {
      email: data.email,
      documentNumber: data.extractedDocNumber,
    });
  };

  // Validate confirm password field (includes cross-field validation)
  const validateConfirmPassword = makeFieldValidator(
    passwordSchema,
    "confirmPassword",
    (value: string) => ({
      password: form.getFieldValue("password"),
      confirmPassword: value,
    }),
  );

  const triggerBreachCheckIfConfirmed = () => {
    const password = form.getFieldValue("password");
    const confirmPassword = form.getFieldValue("confirmPassword");
    if (!password || password !== confirmPassword) return;
    if (getPasswordLengthError(password)) return;
    setBreachStatus("checking");
    setBreachCheckedPassword(password);
    setBreachCheckKey((k) => k + 1);
  };

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
    // Prevent duplicate face matching attempts (expensive ML operation)
    if (faceMatchAttemptedRef.current) return;
    if (!data.idDocumentBase64 || !selfieForMatching) return;
    if (faceMatchStatus !== "idle") return;

    faceMatchAttemptedRef.current = true;

    const performFaceMatch = async () => {
      // Early return if data is missing (shouldn't happen due to outer check)
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
        } else if (result.matched) {
          setFaceMatchStatus("matched");
        } else {
          setFaceMatchStatus("no_match");
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
      }
    };

    performFaceMatch();
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

    // If the confirmed password is known-compromised, stop before doing expensive crypto work.
    if (
      breachStatus === "compromised" &&
      breachCheckedPassword === formData.password
    ) {
      setError(
        "This password has appeared in data breaches. Please choose a different password.",
      );
      passwordInputRef.current?.focus();
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

      // Variables to hold crypto results (generated AFTER account creation)
      let fheResult: {
        ciphertext: string;
        clientKeyId: string;
        encryptionTimeMs: number;
      } | null = null;
      let proofResult: {
        proof: string; // Base64 encoded UltraHonk ZK proof
        publicSignals: string[];
        generationTimeMs: number;
      } | null = null;

      // Create the account before generating server-bound proofs.
      setProofStatus("creating-account");
      const result = await signUp.email({
        email: data.email,
        password: formData.password,
        name: accountName,
      });

      if (result.error) {
        const rawMessage = getBetterAuthErrorMessage(
          result.error,
          "Failed to create account",
        );
        const policyMessage = getPasswordPolicyErrorMessage(result.error);
        setError(policyMessage || rawMessage);
        if (policyMessage) passwordInputRef.current?.focus();
        setProofStatus("error");
        setSubmitting(false);
        return;
      }

      if (birthYear) {
        const currentYear = new Date().getFullYear();

        // Encrypt DOB with FHE (for future homomorphic computations)
        setProofStatus("encrypting");
        try {
          fheResult = await encryptDOB(birthYear);
        } catch (_fheError) {}

        // Generate ZK proof of age (privacy-preserving) - requires server-issued nonce
        setProofStatus("generating");
        try {
          const challenge = await getProofChallenge("age_verification");
          proofResult = await generateAgeProof(birthYear, currentYear, 18, {
            nonce: challenge.nonce,
          });
        } catch (zkError) {
          const errorMessage =
            zkError instanceof Error ? zkError.message : "Unknown error";
          const isTimeout = errorMessage.includes("timed out");
          const isWasmError =
            errorMessage.toLowerCase().includes("wasm") ||
            errorMessage.toLowerCase().includes("module");

          // Log for diagnostics
          // biome-ignore lint/suspicious/noConsole: Error logging for production debugging
          console.error("[step-review] ZK proof generation failed:", {
            error: errorMessage,
            isTimeout,
            isWasmError,
          });

          if (isTimeout) {
            setError(
              "Privacy verification is taking too long. This may be due to " +
                "network issues loading cryptographic libraries. Please refresh " +
                "the page and try again.",
            );
          } else if (isWasmError) {
            setError(
              "Unable to load cryptographic libraries. Please try refreshing " +
                "the page. If using a VPN or content blocker, it may be blocking " +
                "required resources.",
            );
          } else {
            setError(
              "Privacy verification services are temporarily unavailable. " +
                "Your information has not been stored. Please try again in a few minutes.",
            );
          }
          setProofStatus("error");
          setSubmitting(false);
          return;
        }
      }

      // Full identity verification (document + liveness + face matching)
      // Use the same selfie that was used for local face matching (bestSelfieFrame or fallback to selfieImage)
      const selfieToVerify = data.bestSelfieFrame || data.selfieImage;
      if (data.idDocumentBase64 && selfieToVerify) {
        setProofStatus("verifying-identity");
        try {
          const identityResult = await trpc.identity.verify.mutate({
            documentImage: data.idDocumentBase64,
            selfieImage: selfieToVerify,
          });

          if (!identityResult.verified) {
            const issue =
              identityResult.issues?.length && identityResult.issues[0]
                ? identityResult.issues[0]
                : null;
            throw new Error(
              issue ||
                "Identity verification did not pass. Please retake your ID photo and selfie and try again.",
            );
          }
        } catch (identityError) {
          const message =
            identityError instanceof Error
              ? identityError.message
              : "Identity verification failed. Please try again.";
          toast.error("Identity verification incomplete", {
            description: message,
          });
        }
      }

      // Store the proof AND FHE ciphertext
      // NOTE: isOver18 is derived server-side from the verified proof
      if (proofResult) {
        setProofStatus("storing");
        await storeAgeProof(
          proofResult.proof,
          proofResult.publicSignals,
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
      const rpFlow = searchParams.get("rp_flow");
      if (rpFlow) {
        window.location.assign(
          `/api/rp/complete?flow=${encodeURIComponent(rpFlow)}`,
        );
        return;
      }

      window.location.assign("/dashboard");
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
    step: "account" | "encrypt" | "proof" | "identity" | "store",
  ): "pending" | "active" | "complete" | "skipped" => {
    const statusOrder: ProofStatus[] = [
      "idle",
      "creating-account",
      "encrypting",
      "generating",
      "verifying-identity",
      "storing",
      "complete",
    ];
    const currentIndex = statusOrder.indexOf(proofStatus);

    const stepIndices = {
      account: 1,
      encrypt: 2,
      proof: 3,
      identity: 4,
      store: 5,
    };

    // Skip identity step if no documents provided
    if (step === "identity" && !hasIdentityDocs) {
      return "skipped";
    }

    // Skip crypto steps if no DOB
    if (
      (step === "encrypt" || step === "proof" || step === "store") &&
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
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => form.handleSubmit()}
            >
              Try again
            </Button>
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
                    "ring-2 ring-info/40 ring-offset-2",
                )}
              >
                {faceMatchStatus === "matching" &&
                  !faceMatchResult?.idFaceImage && (
                    <Skeleton className="h-full w-full" />
                  )}
                {faceMatchResult?.idFaceImage ? (
                  <img
                    src={faceMatchResult.idFaceImage}
                    alt="Face extracted from your ID (preview)"
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      faceMatchStatus === "matching" && "opacity-70",
                    )}
                  />
                ) : faceMatchStatus !== "matching" ? (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ID face
                  </div>
                ) : null}
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
                    <Loader2 className="h-6 w-6 animate-spin text-info" />
                    <div className="absolute inset-0 h-6 w-6 rounded-full bg-info/20 animate-ping" />
                  </div>
                  <Skeleton className="h-3 w-16 mt-1" />
                </div>
              )}
              {faceMatchStatus === "matched" && (
                <div className="animate-in zoom-in duration-300">
                  <Check className="h-6 w-6 text-success" />
                  <span className="text-xs font-medium text-success">
                    {Math.round((faceMatchResult?.confidence || 0) * 100)}%
                    match
                  </span>
                </div>
              )}
              {faceMatchStatus === "no_match" && (
                <>
                  <XCircle className="h-6 w-6 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    No match
                  </span>
                </>
              )}
              {faceMatchStatus === "error" && (
                <>
                  <XCircle className="h-6 w-6 text-warning" />
                  <span className="text-xs font-medium text-warning">
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
                    "ring-2 ring-info/40 ring-offset-2",
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
            <Alert variant="success">
              <Check className="h-4 w-4" />
              <AlertDescription className="ml-2">
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

      {/* Password Form - kept mounted during submission to prevent TanStack Form disconnect */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        {/* Helps password managers associate the new-password fields to the email used earlier. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={data.email}
          readOnly
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Form fields - only visible when idle */}
        {proofStatus === "idle" && (
          <>
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
                        placeholder="Create a password"
                        autoComplete="new-password"
                        ref={passwordInputRef}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </FieldControl>
                    <FieldMessage />
                    <PasswordRequirements
                      password={field.state.value}
                      email={data.email}
                      documentNumber={data.extractedDocNumber}
                      breachCheckKey={breachCheckKey}
                      onBreachStatusChange={(status, checkedPassword) => {
                        setBreachStatus(status);
                        setBreachCheckedPassword(checkedPassword);
                      }}
                    />
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
                        onBlur={() => {
                          field.handleBlur();
                          triggerBreachCheckIfConfirmed();
                        }}
                      />
                    </FieldControl>
                    <FieldMessage />
                  </Field>
                )}
              </form.Field>
            </div>

            <WizardNavigation
              onNext={() => form.handleSubmit()}
              nextLabel="Complete Registration"
              disableNext={
                breachStatus === "checking" || breachStatus === "compromised"
              }
            />
          </>
        )}

        {/* Processing Status - shown during submission */}
        {proofStatus !== "idle" && proofStatus !== "error" && (
          <div className="space-y-4 rounded-lg border border-info/30 bg-info/10 p-5 text-info animate-in fade-in duration-300">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="h-5 w-5" />
              <span className="font-medium">Securing your account</span>
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

            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-info/30">
              Your personal data is processed transiently. Only cryptographic
              proofs are stored.
            </p>
          </div>
        )}
      </form>

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
                Only commitments, proofs, signed claims, and encrypted
                attributes are stored - all PII is deleted immediately
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
              <li>Identity bundle + document record (type, issuer, status)</li>
              <li>ZK proof metadata (hashes, public inputs, nonces)</li>
              <li>Signed liveness and face-match claims (server measured)</li>
              <li>Encrypted attributes for future compliance checks</li>
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
              You keep control of PII; we keep only cryptographic evidence and
              encrypted attributes needed for compliance verification.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

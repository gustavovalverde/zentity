"use client";

import {
  Check,
  KeyRound,
  Mail,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { registerPasskeyWithPrf } from "@/lib/auth/passkey";
import { generatePrfSalt } from "@/lib/privacy/crypto/key-derivation";
import { checkPrfSupport } from "@/lib/privacy/crypto/webauthn-prf";
import { trpc, trpcReact } from "@/lib/trpc/client";
import { bytesToBase64 } from "@/lib/utils/base64";

type RecoveryPhase =
  | "email"
  | "starting"
  | "pending"
  | "ready"
  | "registering"
  | "complete";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECOVERY_ID_PREFIX = "rec_";
const OTP_DIGITS = 6;
const OTP_SLOT_KEYS = Array.from(
  { length: OTP_DIGITS },
  (_, index) => `otp-slot-${index}`
);

type GuardianType = "email" | "twoFactor";

interface ApprovalToken {
  guardianId: string;
  email: string;
  guardianType: GuardianType;
  token: string;
  tokenExpiresAt: string;
}

function isRecoveryIdentifier(value: string): boolean {
  return value.trim().toLowerCase().startsWith(RECOVERY_ID_PREFIX);
}

function formatMinutesRemaining(expiresAt?: string | null): string | null {
  if (!expiresAt) {
    return null;
  }
  const now = Date.now();
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) {
    return null;
  }
  const remainingMs = end - now;
  if (remainingMs <= 0) {
    return "Expired";
  }
  const minutes = Math.ceil(remainingMs / 60_000);
  return `${minutes} min${minutes === 1 ? "" : "s"} remaining`;
}

export default function RecoverSocialPage() {
  const [phase, setPhase] = useState<RecoveryPhase>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextToken, setContextToken] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);
  const [approvalTokens, setApprovalTokens] = useState<ApprovalToken[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [copiedGuardianId, setCopiedGuardianId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [deviceCode, setDeviceCode] = useState("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceSubmitting, setDeviceSubmitting] = useState(false);
  const [deviceMode, setDeviceMode] = useState<"totp" | "backup">("totp");
  const [deliveryMode, setDeliveryMode] = useState<
    "email" | "mixed" | "manual" | null
  >(null);
  const [deliveredCount, setDeliveredCount] = useState<number | null>(null);
  const [showManualLinks, setShowManualLinks] = useState(false);

  const statusQuery = trpcReact.recovery.status.useQuery(
    { challengeId: challengeId ?? "" },
    {
      enabled: Boolean(challengeId),
      refetchInterval: phase === "pending" ? 3000 : false,
    }
  );

  const approvalsCollected = statusQuery.data?.approvals ?? 0;
  const approvalsThreshold = statusQuery.data?.threshold ?? threshold ?? 0;
  const guardianApprovals = statusQuery.data?.guardianApprovals ?? [];

  const approvalStatusById = useMemo(() => {
    const entries = guardianApprovals.map((entry): [string, string | null] => [
      entry.guardianId,
      entry.approvedAt ?? null,
    ]);
    return new Map<string, string | null>(entries);
  }, [guardianApprovals]);

  const approvalEntries = useMemo(
    () =>
      approvalTokens.map((entry) => ({
        ...entry,
        approvedAt: approvalStatusById.get(entry.guardianId) ?? null,
      })),
    [approvalStatusById, approvalTokens]
  );
  const expiresLabel = useMemo(
    () => formatMinutesRemaining(statusQuery.data?.expiresAt),
    [statusQuery.data?.expiresAt]
  );

  const step = useMemo(() => {
    if (phase === "pending") {
      return 2;
    }
    if (phase === "ready" || phase === "registering") {
      return 3;
    }
    return 1;
  }, [phase]);

  const stepLabel = useMemo(() => {
    if (phase === "pending") {
      return "Step 2 of 3 · Guardian approvals";
    }
    if (phase === "ready" || phase === "registering") {
      return "Step 3 of 3 · Set a new passkey";
    }
    if (phase === "complete") {
      return "Done";
    }
    return "Step 1 of 3 · Verify your account";
  }, [phase]);

  const approvalLinks = useMemo(() => {
    const origin =
      globalThis.window === undefined ? "" : globalThis.window.location.origin;
    return approvalEntries
      .filter((approval) => approval.guardianType === "email")
      .map((approval) => ({
        ...approval,
        url: origin
          ? `${origin}/recover-guardian?token=${approval.token}`
          : `/recover-guardian?token=${approval.token}`,
      }));
  }, [approvalEntries]);
  const approvalLinkByGuardianId = useMemo(
    () =>
      new Map(approvalLinks.map((approval) => [approval.guardianId, approval])),
    [approvalLinks]
  );

  const deviceApproval = useMemo(
    () =>
      approvalEntries.find((approval) => approval.guardianType === "twoFactor"),
    [approvalEntries]
  );
  const deviceApproved = Boolean(deviceApproval?.approvedAt);

  const emailApprovals = useMemo(
    () => approvalEntries.filter((entry) => entry.guardianType === "email"),
    [approvalEntries]
  );
  const hasEmailApprovals = emailApprovals.length > 0;
  const deviceApproveLabel =
    deviceMode === "totp"
      ? "Approve with authenticator"
      : "Approve with backup code";
  const deviceToggleLabel =
    deviceMode === "totp" ? "Use a backup code" : "Use authenticator code";

  const emailApprovalCopy = useMemo(() => {
    if (!hasEmailApprovals) {
      return null;
    }
    const parts = ["We emailed your guardians to approve this recovery."];
    if (deliveryMode === "mixed") {
      parts.push(" Some emails failed—share manual links below.");
    } else if (deliveryMode && deliveryMode !== "email") {
      parts.push(" Email delivery is not configured—share manual links below.");
    }
    if (deviceApproval) {
      parts.push(" Enter your authenticator or backup code once you’re ready.");
    }
    return parts.join("");
  }, [deliveryMode, deviceApproval, hasEmailApprovals]);

  const getGuardianStatusLabel = (approved: boolean) => {
    if (approved) {
      return "Approval received.";
    }
    if (deliveryMode === "email") {
      return "Email sent. Waiting for confirmation.";
    }
    return "Share a manual approval link with this guardian.";
  };

  useEffect(() => {
    if (!hasEmailApprovals) {
      setShowManualLinks(false);
      return;
    }
    if (deliveryMode === "email") {
      setShowManualLinks(false);
      return;
    }
    if (deliveryMode) {
      setShowManualLinks(true);
    }
  }, [deliveryMode, hasEmailApprovals]);

  useEffect(() => {
    if (!statusQuery.data || phase !== "pending") {
      return;
    }
    if (statusQuery.data.status === "completed") {
      setPhase("ready");
    }
    if (
      statusQuery.data.status === "pending" &&
      statusQuery.data.expiresAt &&
      new Date(statusQuery.data.expiresAt) < new Date()
    ) {
      setError("Recovery request expired. Please start again.");
      setPhase("email");
    }
  }, [phase, statusQuery.data]);

  const copyToClipboard = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const handleCopyLink = async (guardianId: string, url: string) => {
    const ok = await copyToClipboard(url);
    if (!ok) {
      toast.error("Could not copy link. Please copy it manually.");
      return;
    }
    setCopiedGuardianId(guardianId);
    setTimeout(() => setCopiedGuardianId(null), 2000);
  };

  const handleCopyAll = async () => {
    const list = approvalLinks.map((entry) => entry.url).join("\n");
    const ok = await copyToClipboard(list);
    if (!ok) {
      toast.error("Could not copy links. Please copy them manually.");
      return;
    }
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleDeviceApprove = async () => {
    if (!deviceApproval) {
      return;
    }
    const trimmed =
      deviceMode === "totp"
        ? deviceCode.replaceAll(/\s+/g, "")
        : deviceCode.replaceAll(/[^a-zA-Z0-9]/g, "");
    if (!trimmed) {
      setDeviceError(
        deviceMode === "totp"
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of your backup codes."
      );
      return;
    }
    if (deviceMode === "totp" && trimmed.length !== OTP_DIGITS) {
      setDeviceError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (deviceMode === "backup" && trimmed.length < 8) {
      setDeviceError("Enter one of your backup codes.");
      return;
    }

    setDeviceError(null);
    setDeviceSubmitting(true);

    try {
      await trpc.recovery.approveGuardian.mutate({
        token: deviceApproval.token,
        code: trimmed,
      });
      await statusQuery.refetch();
      toast.success("Authenticator approval recorded.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to verify authenticator code.";
      setDeviceError(message);
      toast.error("Authenticator verification failed", {
        description: message,
      });
    } finally {
      setDeviceSubmitting(false);
    }
  };

  const toggleDeviceMode = (next: "totp" | "backup") => {
    setDeviceMode(next);
    setDeviceCode("");
    setDeviceError(null);
  };

  const ensurePrfSupport = async () => {
    if (prfSupported !== null) {
      return prfSupported;
    }
    try {
      const result = await checkPrfSupport();
      setPrfSupported(result.supported);
      return result.supported;
    } catch {
      setPrfSupported(false);
      return false;
    }
  };

  const handleStartRecovery = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Email or Recovery ID is required");
      return;
    }
    if (!(EMAIL_PATTERN.test(trimmed) || isRecoveryIdentifier(trimmed))) {
      setEmailError("Enter a valid email or Recovery ID");
      return;
    }

    setEmailError(null);
    setError(null);
    setPhase("starting");
    setDeviceCode("");
    setDeviceError(null);
    setDeviceMode("totp");

    try {
      const result = await trpc.recovery.start.mutate({ identifier: trimmed });
      setContextToken(result.contextToken);
      setChallengeId(result.challengeId);
      const approvals: ApprovalToken[] = result.approvals.map((approval) => ({
        ...approval,
        guardianType:
          approval.guardianType === "twoFactor" ? "twoFactor" : "email",
      }));
      setApprovalTokens(approvals);
      setThreshold(result.threshold);
      setDeliveryMode(result.delivery ?? "manual");
      setDeliveredCount(
        typeof result.deliveredCount === "number" ? result.deliveredCount : null
      );
      setPhase("pending");
      if (result.delivery === "email") {
        toast.success("Recovery started. Emails sent to guardians.");
      } else if (result.delivery === "mixed") {
        toast.message("Recovery started. Some emails failed to send.");
      } else {
        toast.message("Recovery started. Share approval links.");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start recovery.";
      setError(message);
      setPhase("email");
    }
  };

  const handleRegisterPasskey = async () => {
    if (!contextToken) {
      setError("Missing recovery context. Please start again.");
      return;
    }

    const supported = await ensurePrfSupport();
    if (!supported) {
      setError("Your device does not support the required passkey features.");
      return;
    }

    setError(null);
    setPhase("registering");

    try {
      const prfSalt = generatePrfSalt();
      const registration = await registerPasskeyWithPrf({
        name: "Recovered Passkey",
        prfSalt,
        context: contextToken,
      });

      if (!registration.ok) {
        throw new Error(registration.message);
      }

      const { credentialId, prfOutput } = registration;

      if (!challengeId) {
        throw new Error("Missing recovery challenge.");
      }

      await trpc.recovery.finalize.mutate({
        challengeId,
        contextToken,
        credentialType: "passkey",
        credentialId,
        prfSalt: bytesToBase64(prfSalt),
        prfOutput: bytesToBase64(prfOutput),
      });

      setPhase("complete");
      toast.success("Passkey registered successfully!");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to register passkey. Please try again.";

      if (
        message.includes("NotAllowedError") ||
        message.includes("cancelled")
      ) {
        setPhase("ready");
        return;
      }

      setError(message);
      setPhase("ready");
      toast.error("Registration failed", { description: message });
    }
  };

  let icon = <Mail className="size-6 text-primary" />;
  if (phase === "complete") {
    icon = <Check className="size-6 text-success" />;
  } else if (phase === "ready" || phase === "registering") {
    icon = <KeyRound className="size-6 text-primary" />;
  } else if (phase === "pending") {
    icon = <ShieldCheck className="size-6 text-primary" />;
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
        <CardTitle>Guardian Recovery</CardTitle>
        <CardDescription>
          Recover access with guardian approval and set a new passkey.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{stepLabel}</span>
            <span>{Math.min(step, 3)}/3</span>
          </div>
          <Progress value={(Math.min(step, 3) / 3) * 100} />
        </div>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {(phase === "email" || phase === "starting") && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="recovery-email">
                Email or Recovery ID
              </FieldLabel>
              <Input
                disabled={phase === "starting"}
                id="recovery-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com or rec_XXXX"
                type="text"
                value={email}
              />
              {emailError ? <FieldError>{emailError}</FieldError> : null}
            </Field>
            <Button
              className="w-full"
              disabled={phase === "starting"}
              onClick={handleStartRecovery}
            >
              {phase === "starting" ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Starting recovery...
                </>
              ) : (
                "Start guardian recovery"
              )}
            </Button>
          </FieldGroup>
        )}

        {phase === "pending" && (
          <div className="space-y-4">
            <div className="rounded-md border border-dashed px-3 py-2 text-muted-foreground text-sm">
              {hasEmailApprovals ? emailApprovalCopy : null}
              {hasEmailApprovals ? null : (
                <>
                  Use your authenticator app or backup code to approve this
                  recovery.
                </>
              )}
            </div>
            {hasEmailApprovals && deliveryMode === "email" && (
              <div className="text-muted-foreground text-sm">
                Emails sent to {deliveredCount ?? approvalLinks.length}/
                {approvalLinks.length} guardians.
              </div>
            )}
            {expiresLabel ? (
              <div className="text-muted-foreground text-xs">
                Recovery request{" "}
                {expiresLabel === "Expired"
                  ? "expired"
                  : `expires in ${expiresLabel}.`}
              </div>
            ) : null}
            {hasEmailApprovals ? (
              <Button
                onClick={() => setShowManualLinks((current) => !current)}
                type="button"
                variant="secondary"
              >
                {showManualLinks ? "Hide manual links" : "Show manual links"}
              </Button>
            ) : null}
            <div className="space-y-3">
              {emailApprovals.map((approval) => {
                const approved = Boolean(approval.approvedAt);
                const manualLink = approvalLinkByGuardianId.get(
                  approval.guardianId
                );
                const showManual = Boolean(manualLink && showManualLinks);

                return (
                  <div
                    className="rounded-md border px-3 py-3"
                    key={approval.guardianId}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">
                          {approval.email}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {getGuardianStatusLabel(approved)}
                        </div>
                      </div>
                      <Badge variant={approved ? "secondary" : "outline"}>
                        {approved ? "Approved" : "Pending"}
                      </Badge>
                    </div>
                    {showManual && !approved && manualLink ? (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between font-medium text-sm">
                          <span>Manual approval link</span>
                          <Button
                            onClick={() =>
                              handleCopyLink(
                                manualLink.guardianId,
                                manualLink.url
                              )
                            }
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            {copiedGuardianId === manualLink.guardianId
                              ? "Copied"
                              : "Copy"}
                          </Button>
                        </div>
                        <Input
                          data-guardian-link={manualLink.guardianId}
                          readOnly
                          value={manualLink.url}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {showManualLinks && emailApprovals.length > 1 ? (
                <Button
                  onClick={handleCopyAll}
                  type="button"
                  variant="secondary"
                >
                  {copiedAll ? "All links copied" : "Copy all links"}
                </Button>
              ) : null}
              {deviceApproval ? (
                <div className="rounded-md border px-3 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">
                        Authenticator approval
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {deviceMode === "totp"
                          ? "Enter the 6-digit code from your authenticator app."
                          : "Enter one of your backup codes."}
                      </div>
                    </div>
                    <Badge variant={deviceApproved ? "secondary" : "outline"}>
                      {deviceApproved ? "Approved" : "Pending"}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {deviceMode === "totp" ? (
                      <InputOTP
                        disabled={deviceSubmitting || deviceApproved}
                        maxLength={OTP_DIGITS}
                        onChange={(value) => {
                          setDeviceCode(value);
                          setDeviceError(null);
                        }}
                        value={deviceCode}
                      >
                        <InputOTPGroup>
                          {OTP_SLOT_KEYS.map((key, index) => (
                            <InputOTPSlot index={index} key={key} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    ) : (
                      <Input
                        disabled={deviceSubmitting || deviceApproved}
                        onChange={(event) => {
                          setDeviceCode(event.target.value);
                          setDeviceError(null);
                        }}
                        placeholder="XXXXX-XXXXX"
                        value={deviceCode}
                      />
                    )}
                    {deviceError ? (
                      <FieldError>{deviceError}</FieldError>
                    ) : null}
                    <Button
                      className="w-full"
                      disabled={deviceSubmitting || deviceApproved}
                      onClick={handleDeviceApprove}
                      type="button"
                    >
                      {deviceSubmitting ? (
                        <>
                          <Spinner className="mr-2 size-4" />
                          Verifying code...
                        </>
                      ) : (
                        deviceApproveLabel
                      )}
                    </Button>
                    <Button
                      className="w-full"
                      disabled={deviceSubmitting || deviceApproved}
                      onClick={() =>
                        toggleDeviceMode(
                          deviceMode === "totp" ? "backup" : "totp"
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      {deviceToggleLabel}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Approvals collected</span>
              <Badge variant="secondary">
                {approvalsCollected}/
                {approvalsThreshold || approvalTokens.length}
              </Badge>
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Waiting for guardian approvals...
            </div>
          </div>
        )}

        {phase === "ready" && (
          <div className="space-y-3 text-center">
            <Badge variant="secondary">Approvals complete</Badge>
            <Button className="w-full" onClick={handleRegisterPasskey}>
              Register new passkey
            </Button>
          </div>
        )}

        {phase === "registering" && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            Registering your new passkey...
          </div>
        )}

        {phase === "complete" && (
          <Alert variant="success">
            <Check className="size-4" />
            <AlertDescription>
              Recovery complete. You can now sign in with your new passkey.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

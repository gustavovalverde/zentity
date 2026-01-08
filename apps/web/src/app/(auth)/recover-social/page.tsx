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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { registerPasskeyWithPrf } from "@/lib/auth/passkey";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import { checkPrfSupport } from "@/lib/crypto/webauthn-prf";
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

interface ApprovalToken {
  guardianId: string;
  email: string;
  token: string;
  tokenExpiresAt: string;
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
    return "Step 1 of 3 · Verify your email";
  }, [phase]);

  const approvalLinks = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return approvalTokens.map((approval) => ({
      ...approval,
      url: origin
        ? `${origin}/recover-guardian?token=${approval.token}`
        : `/recover-guardian?token=${approval.token}`,
    }));
  }, [approvalTokens]);

  useEffect(() => {
    if (!deliveryMode) {
      return;
    }
    setShowManualLinks(deliveryMode !== "email");
  }, [deliveryMode]);

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
      setEmailError("Email is required");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError("Invalid email address");
      return;
    }

    setEmailError(null);
    setError(null);
    setPhase("starting");

    try {
      const result = await trpc.recovery.start.mutate({ email: trimmed });
      setContextToken(result.contextToken);
      setChallengeId(result.challengeId);
      setApprovalTokens(result.approvals);
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
    icon = <Check className="size-6 text-emerald-600" />;
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
        <CardTitle>Social Recovery</CardTitle>
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
              <FieldLabel htmlFor="recovery-email">Email</FieldLabel>
              <Input
                disabled={phase === "starting"}
                id="recovery-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
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
              {deliveryMode === "email" && (
                <>
                  We emailed guardians about your recovery. If someone can’t
                  find it, share a manual link.
                </>
              )}
              {deliveryMode === "mixed" && (
                <>Some guardian emails failed. Share links below.</>
              )}
              {deliveryMode !== "email" && deliveryMode !== "mixed" && (
                <>Email delivery is not configured. Share links below.</>
              )}
            </div>
            {deliveryMode === "email" && (
              <div className="text-muted-foreground text-sm">
                Emails sent to {deliveredCount ?? approvalLinks.length}/
                {approvalLinks.length} guardians.
              </div>
            )}
            {deliveryMode === "email" ? (
              <Collapsible
                onOpenChange={setShowManualLinks}
                open={showManualLinks}
              >
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="secondary">
                    {showManualLinks
                      ? "Hide manual links"
                      : "Show manual links"}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  {approvalLinks.map((approval) => (
                    <div className="space-y-1" key={approval.guardianId}>
                      <div className="flex items-center justify-between font-medium text-sm">
                        <span>{approval.email}</span>
                        <Button
                          onClick={() =>
                            handleCopyLink(approval.guardianId, approval.url)
                          }
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {copiedGuardianId === approval.guardianId
                            ? "Copied"
                            : "Copy"}
                        </Button>
                      </div>
                      <Input
                        data-guardian-link={approval.guardianId}
                        readOnly
                        value={approval.url}
                      />
                    </div>
                  ))}
                  {approvalLinks.length > 1 && (
                    <Button
                      onClick={handleCopyAll}
                      type="button"
                      variant="secondary"
                    >
                      {copiedAll ? "All links copied" : "Copy all links"}
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <>
                <div className="space-y-3">
                  {approvalLinks.map((approval) => (
                    <div className="space-y-1" key={approval.guardianId}>
                      <div className="flex items-center justify-between font-medium text-sm">
                        <span>{approval.email}</span>
                        <Button
                          onClick={() =>
                            handleCopyLink(approval.guardianId, approval.url)
                          }
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {copiedGuardianId === approval.guardianId
                            ? "Copied"
                            : "Copy"}
                        </Button>
                      </div>
                      <Input
                        data-guardian-link={approval.guardianId}
                        readOnly
                        value={approval.url}
                      />
                    </div>
                  ))}
                </div>
                {approvalLinks.length > 1 && (
                  <Button
                    onClick={handleCopyAll}
                    type="button"
                    variant="secondary"
                  >
                    {copiedAll ? "All links copied" : "Copy all links"}
                  </Button>
                )}
              </>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Approvals collected</span>
              <Badge variant="secondary">
                {approvalsCollected}/
                {approvalsThreshold || approvalLinks.length}
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
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-emerald-700 text-sm">
            Recovery complete. You can now sign in with your new passkey.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

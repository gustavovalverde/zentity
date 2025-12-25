"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Progress } from "@/components/ui/progress";
import {
  checkPasswordPwned,
  getPasswordRequirementStatus,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Live password requirements / strength UI.
 *
 * This component is intentionally split from the auth flows so we can reuse it
 * for onboarding sign-up, reset password, and change password.
 *
 * The breached-password check is:
 * - Triggered by the parent via `breachCheckKey` (e.g., on confirm-password blur
 *   when both fields match).
 * - UX-only. Server-side enforcement remains in Better Auth (haveIBeenPwned()).
 *
 * Required vs recommended:
 * - "Required" reflects our current client policy expectations (length + not
 *   containing obvious identifiers like email/doc number).
 * - "Recommended" is guidance only (diversity checks), and is not enforced as a
 *   hard block by our client schema or Better Auth.
 */

type PwnedStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "safe" }
  | { state: "compromised" }
  | { state: "error" };

function Requirement({
  ok,
  label,
  tone = "neutral",
}: {
  ok: boolean;
  label: string;
  tone?: "neutral" | "danger" | "success";
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full border",
          ok
            ? tone === "danger"
              ? "border-destructive text-destructive"
              : "border-success text-success"
            : "border-muted-foreground/40 text-muted-foreground/60",
        )}
        aria-hidden
      >
        {ok ? <Check className="h-3 w-3" /> : null}
      </span>
      <span
        className={cn(
          ok && tone === "danger" && "text-destructive",
          ok && tone !== "danger" && "text-success",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function PasswordRequirements({
  password,
  email,
  documentNumber,
  breachCheckKey,
  onBreachStatusChange,
}: {
  password: string;
  email?: string | null;
  documentNumber?: string | null;
  /**
   * A monotonically increasing value used to trigger a breach check.
   * The component will run a check whenever this value changes.
   */
  breachCheckKey?: number;
  /**
   * Optional callback for parents that want to "hold" submission while checking
   * or block when the password is compromised.
   */
  onBreachStatusChange?: (
    status: PwnedStatus["state"],
    checkedPassword: string | null,
  ) => void;
}) {
  const [pwned, setPwned] = useState<PwnedStatus>({ state: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const checkedPasswordRef = useRef<string | null>(null);
  const lastBreachCheckKeyRef = useRef<number>(0);
  const onBreachStatusChangeRef = useRef(onBreachStatusChange);

  useEffect(() => {
    onBreachStatusChangeRef.current = onBreachStatusChange;
  }, [onBreachStatusChange]);

  const status = useMemo(
    () =>
      getPasswordRequirementStatus(password, {
        email,
        documentNumber,
      }),
    [password, email, documentNumber],
  );

  const diversityMetCount = useMemo(() => {
    return [
      status.hasLower,
      status.hasUpper,
      status.hasNumber,
      status.hasSymbol,
    ].filter(Boolean).length;
  }, [status.hasLower, status.hasUpper, status.hasNumber, status.hasSymbol]);

  const score = useMemo(() => {
    // Lightweight score purely for UX feedback (not used as a hard policy):
    // - length: up to 40 points
    // - diversity: up to 40 points
    // - similarity checks: up to 20 points
    const lengthPoints = Math.min(
      40,
      Math.max(0, password.length - (PASSWORD_MIN_LENGTH - 1)) * 4,
    );
    const diversityPoints = diversityMetCount * 10;
    const similarityPoints =
      (status.noEmail ? 10 : 0) + (status.noDocNumber ? 10 : 0);
    return Math.max(
      0,
      Math.min(100, lengthPoints + diversityPoints + similarityPoints),
    );
  }, [password.length, diversityMetCount, status.noEmail, status.noDocNumber]);

  const strengthLabel = useMemo(() => {
    if (!password) return " ";
    if (score >= 80) return "Strong";
    if (score >= 55) return "Good";
    if (score >= 30) return "Okay";
    return "Weak";
  }, [password, score]);

  useEffect(() => {
    if (checkedPasswordRef.current && checkedPasswordRef.current !== password) {
      checkedPasswordRef.current = null;
      setPwned({ state: "idle" });
      onBreachStatusChangeRef.current?.("idle", null);
    }
  }, [password]);

  useEffect(() => {
    if (!breachCheckKey) return;
    if (breachCheckKey === lastBreachCheckKeyRef.current) return;
    lastBreachCheckKeyRef.current = breachCheckKey;
    if (!password || password.length < PASSWORD_MIN_LENGTH) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPwned({ state: "checking" });
    onBreachStatusChangeRef.current?.("checking", null);

    let isActive = true;
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);

    void (async () => {
      try {
        const data = await checkPasswordPwned(password, {
          signal: controller.signal,
        });

        if (!isActive) return;

        if (data.skipped) {
          setPwned({ state: "error" });
          onBreachStatusChangeRef.current?.("error", null);
          return;
        }

        const nextState: PwnedStatus["state"] = data.compromised
          ? "compromised"
          : "safe";
        checkedPasswordRef.current = password;
        setPwned({ state: nextState });
        onBreachStatusChangeRef.current?.(nextState, password);
      } catch (_err) {
        if (!isActive) return;
        setPwned({ state: "error" });
        onBreachStatusChangeRef.current?.("error", null);
      }
    })();

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [breachCheckKey, password]);

  const breachRow = useMemo(() => {
    if (pwned.state === "idle") return null;
    if (pwned.state === "checking") {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          <span>Checking known breaches…</span>
        </div>
      );
    }
    if (pwned.state === "safe") {
      return (
        <div className="text-xs text-success">Not found in known breaches</div>
      );
    }
    if (pwned.state === "compromised") {
      return (
        <div className="text-xs text-destructive">
          Found in known breaches — choose a different password
        </div>
      );
    }
    return (
      <div className="text-xs text-muted-foreground">
        Couldn’t check breaches right now — we’ll re-check when you submit.
      </div>
    );
  }, [pwned.state]);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Strength</span>
        <span
          className={cn(
            "text-xs font-medium",
            strengthLabel === "Strong" && "text-success",
            strengthLabel === "Good" && "text-success",
            strengthLabel === "Okay" && "text-muted-foreground",
            strengthLabel === "Weak" && "text-destructive",
          )}
        >
          {strengthLabel}
        </span>
      </div>

      <Progress value={password ? score : 0} className="h-2" />

      <div className="space-y-1">
        <div className="pt-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Required
        </div>
        <Requirement
          ok={status.lengthOk}
          label={`At least ${PASSWORD_MIN_LENGTH} characters`}
        />
        {email?.split("@")[0] && (
          <Requirement ok={status.noEmail} label="Doesn't contain your email" />
        )}
        {documentNumber && (
          <Requirement
            ok={status.noDocNumber}
            label="Doesn't contain your document number"
          />
        )}
        <div className="pt-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Recommended
        </div>
        <Requirement ok={status.hasLower} label="Includes a lowercase letter" />
        <Requirement
          ok={status.hasUpper}
          label="Includes an uppercase letter"
        />
        <Requirement ok={status.hasNumber} label="Includes a number" />
        <Requirement ok={status.hasSymbol} label="Includes a symbol" />
      </div>

      {breachRow ? <div aria-live="polite">{breachRow}</div> : null}
    </div>
  );
}

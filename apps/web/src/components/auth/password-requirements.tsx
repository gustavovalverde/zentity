"use client";

import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  getPasswordRequirementStatus,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";
import { checkPasswordPwned } from "@/lib/auth/password-pwned";
import { cn } from "@/lib/utils/classname";

/**
 * Live password requirements / strength UI.
 *
 * This component is intentionally split from the auth flows so we can reuse it
 * for sign-up, reset password, and change password.
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

function getIndicatorClass(
  ok: boolean,
  tone: "neutral" | "danger" | "success"
) {
  if (!ok) {
    return "border-muted-foreground/40 text-muted-foreground/60";
  }
  if (tone === "danger") {
    return "border-destructive text-destructive";
  }
  return "border-success text-success";
}

function Requirement({
  ok,
  label,
  tone = "neutral",
}: Readonly<{
  ok: boolean;
  label: string;
  tone?: "neutral" | "danger" | "success";
}>) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full border",
          getIndicatorClass(ok, tone)
        )}
      >
        {ok ? <Check className="h-3 w-3" /> : null}
      </span>
      <span
        className={cn(
          ok && tone === "danger" && "text-destructive",
          ok && tone !== "danger" && "text-success"
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
}: Readonly<{
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
    checkedPassword: string | null
  ) => void;
}>) {
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
    [password, email, documentNumber]
  );

  const diversityMetCount = useMemo(
    () =>
      [
        status.hasLower,
        status.hasUpper,
        status.hasNumber,
        status.hasSymbol,
      ].filter(Boolean).length,
    [status.hasLower, status.hasUpper, status.hasNumber, status.hasSymbol]
  );

  const score = useMemo(() => {
    // Lightweight score purely for UX feedback (not used as a hard policy):
    // - length: up to 40 points
    // - diversity: up to 40 points
    // - similarity checks: up to 20 points
    const lengthPoints = Math.min(
      40,
      Math.max(0, password.length - (PASSWORD_MIN_LENGTH - 1)) * 4
    );
    const diversityPoints = diversityMetCount * 10;
    const similarityPoints =
      (status.noEmail ? 10 : 0) + (status.noDocNumber ? 10 : 0);
    return Math.max(
      0,
      Math.min(100, lengthPoints + diversityPoints + similarityPoints)
    );
  }, [password.length, diversityMetCount, status.noEmail, status.noDocNumber]);

  const strengthLabel = useMemo(() => {
    if (!password) {
      return " ";
    }
    if (score >= 80) {
      return "Strong";
    }
    if (score >= 55) {
      return "Good";
    }
    if (score >= 30) {
      return "Okay";
    }
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
    if (!breachCheckKey) {
      return;
    }
    if (breachCheckKey === lastBreachCheckKeyRef.current) {
      return;
    }
    lastBreachCheckKeyRef.current = breachCheckKey;
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPwned({ state: "checking" });
    onBreachStatusChangeRef.current?.("checking", null);

    let isActive = true;
    const timeoutId = globalThis.window.setTimeout(
      () => controller.abort(),
      6000
    );

    (async () => {
      try {
        const data = await checkPasswordPwned(password, {
          signal: controller.signal,
        });

        if (!isActive) {
          return;
        }

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
      } catch {
        if (!isActive) {
          return;
        }
        setPwned({ state: "error" });
        onBreachStatusChangeRef.current?.("error", null);
      }
    })().catch(() => {
      // Error handled via state updates
    });

    return () => {
      isActive = false;
      globalThis.window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [breachCheckKey, password]);

  const breachRow = useMemo(() => {
    if (pwned.state === "idle") {
      return null;
    }
    if (pwned.state === "checking") {
      return (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner aria-hidden className="size-3" />
          <span>Checking known breaches…</span>
        </div>
      );
    }
    if (pwned.state === "safe") {
      return (
        <div className="text-success text-xs">Not found in known breaches</div>
      );
    }
    if (pwned.state === "compromised") {
      return (
        <div className="text-destructive text-xs">
          Found in known breaches — choose a different password
        </div>
      );
    }
    return (
      <div className="text-muted-foreground text-xs">
        Couldn’t check breaches right now — we’ll re-check when you submit.
      </div>
    );
  }, [pwned.state]);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Strength</span>
        <span
          className={cn(
            "font-medium text-xs",
            strengthLabel === "Strong" && "text-success",
            strengthLabel === "Good" && "text-success",
            strengthLabel === "Okay" && "text-muted-foreground",
            strengthLabel === "Weak" && "text-destructive"
          )}
        >
          {strengthLabel}
        </span>
      </div>

      <Progress className="h-2" value={password ? score : 0} />

      <div className="space-y-1">
        <div className="pt-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Required
        </div>
        <Requirement
          label={`At least ${PASSWORD_MIN_LENGTH} characters`}
          ok={status.lengthOk}
        />
        {email?.split("@")[0] ? (
          <Requirement label="Doesn't contain your email" ok={status.noEmail} />
        ) : null}
        {documentNumber ? (
          <Requirement
            label="Doesn't contain your document number"
            ok={status.noDocNumber}
          />
        ) : null}
        <div className="pt-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Recommended
        </div>
        <Requirement label="Includes a lowercase letter" ok={status.hasLower} />
        <Requirement
          label="Includes an uppercase letter"
          ok={status.hasUpper}
        />
        <Requirement label="Includes a number" ok={status.hasNumber} />
        <Requirement label="Includes a symbol" ok={status.hasSymbol} />
      </div>

      {breachRow ? <div aria-live="polite">{breachRow}</div> : null}
    </div>
  );
}

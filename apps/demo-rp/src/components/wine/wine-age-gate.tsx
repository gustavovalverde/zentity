"use client";

import { ArrowLeft01Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";

interface WineAgeGateProps {
  dcrConfig: { clientName: string; defaultScopes: string };
  onVerify: () => void;
  providerId: string;
}

function WineIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WineAgeGate({
  dcrConfig,
  providerId,
  onVerify,
}: WineAgeGateProps) {
  const [dcrReady, setDcrReady] = useState(false);
  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  return (
    <div
      className="flex min-h-screen flex-col bg-background font-serif text-foreground selection:bg-primary/30"
      data-theme="wine"
    >
      <header className="flex items-center justify-between border-border border-b px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <WineIcon className="size-5" />
          </div>
          <div>
            <span className="font-medium text-xl tracking-wide">
              Vino Delivery
            </span>
            <span className="block text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Est. 1928
            </span>
          </div>
        </div>
        <Link
          className="flex items-center gap-1.5 font-sans text-muted-foreground text-sm transition-colors hover:text-foreground"
          href="/"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          Demos
        </Link>
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
        <div className="pointer-events-none absolute top-1/4 -right-32 size-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="pointer-events-none absolute bottom-1/4 -left-32 size-[500px] rounded-full bg-accent/5 blur-3xl" />

        <div className="relative z-10 w-full max-w-md space-y-10 text-center">
          <div className="space-y-6">
            <div className="mx-auto flex size-20 items-center justify-center rounded-full border border-primary/20 bg-primary/5">
              <span className="font-bold text-4xl text-primary">21+</span>
            </div>
            <h1 className="font-medium text-4xl leading-tight md:text-5xl">
              Age Verification
              <br />
              <span className="text-primary italic">Required</span>
            </h1>
            <p className="mx-auto max-w-sm font-sans text-lg text-muted-foreground leading-relaxed">
              You must be 21 or older to browse and purchase alcohol. Verify
              your age through Zentity — your exact birthdate is never shared.
            </p>
          </div>

          <div className="space-y-4 pt-2">
            <DcrRegistration
              clientName={dcrConfig.clientName}
              defaultScopes={dcrConfig.defaultScopes}
              onRegistered={handleDcrRegistered}
              providerId={providerId}
            />
            <Button
              className="h-14 w-full gap-3 rounded-none bg-primary font-medium text-lg text-primary-foreground uppercase tracking-widest transition-all hover:bg-primary/90 disabled:opacity-40"
              disabled={!dcrReady}
              onClick={onVerify}
              size="lg"
            >
              <HugeiconsIcon icon={ShieldKeyIcon} size={20} />
              Verify Age with Zentity
            </Button>
            <p className="text-muted-foreground text-xs uppercase tracking-widest">
              Only a yes/no proof is shared — never your birthdate
            </p>
          </div>
        </div>
      </div>

      <footer className="border-border border-t py-6 text-center text-muted-foreground text-xs uppercase tracking-widest">
        Please drink responsibly
      </footer>
    </div>
  );
}

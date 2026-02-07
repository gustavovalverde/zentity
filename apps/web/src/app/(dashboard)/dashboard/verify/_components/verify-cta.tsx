"use client";

import Link from "next/link";
import { useState } from "react";

import { Web3Provider } from "@/components/providers/web3-provider";
import { Button } from "@/components/ui/button";

import { FheEnrollmentDialog } from "./fhe-enrollment-dialog";

interface VerifyCtaProps {
  nextStepHref: string;
  nextStepTitle: string;
  hasEnrollment: boolean;
  hasPasskeys: boolean;
  hasPassword: boolean;
  wallet: { address: string; chainId: number } | null;
  cookies: string | null;
  walletScopeId: string | null;
}

/**
 * CTA button for the verify page.
 * If enrolled, links directly to the next step.
 * If not enrolled, opens the FHE enrollment dialog.
 */
export function VerifyCta({
  nextStepHref,
  nextStepTitle,
  hasEnrollment,
  hasPasskeys,
  hasPassword,
  wallet,
  cookies,
  walletScopeId,
}: Readonly<VerifyCtaProps>) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (hasEnrollment) {
    return (
      <Button asChild className="w-full">
        <Link href={nextStepHref}>Continue with {nextStepTitle}</Link>
      </Button>
    );
  }

  const dialog = (
    <FheEnrollmentDialog
      hasPasskeys={hasPasskeys}
      hasPassword={hasPassword}
      onOpenChange={setDialogOpen}
      open={dialogOpen}
      wallet={wallet}
    />
  );

  const button = (
    <Button className="w-full" onClick={() => setDialogOpen(true)}>
      Get Started
    </Button>
  );

  if (wallet) {
    return (
      <Web3Provider cookies={cookies} walletScopeId={walletScopeId}>
        {button}
        {dialog}
      </Web3Provider>
    );
  }

  return (
    <>
      {button}
      {dialog}
    </>
  );
}

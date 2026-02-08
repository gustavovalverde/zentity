"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Web3Provider } from "@/components/providers/web3-provider";
import { Button } from "@/components/ui/button";

const FheEnrollmentDialog = dynamic(
  () => import("./fhe-enrollment-dialog").then((m) => m.FheEnrollmentDialog),
  { ssr: false }
);

interface VerifyCtaProps {
  nextStepHref: string;
  nextStepTitle: string;
  hasEnrollment: boolean;
  hasPasskeys: boolean;
  hasPassword: boolean;
  wallet: { address: string; chainId: number } | null;
  cookies: string | null;
}

/**
 * CTA button for the verify page.
 * If enrolled, links directly to the next step.
 * If not enrolled, opens the FHE enrollment dialog.
 */
const preloadDialog = () => import("./fhe-enrollment-dialog");

export function VerifyCta({
  nextStepHref,
  nextStepTitle,
  hasEnrollment,
  hasPasskeys,
  hasPassword,
  wallet,
  cookies,
}: Readonly<VerifyCtaProps>) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpen = useCallback(() => setDialogOpen(true), []);

  if (hasEnrollment) {
    return (
      <Button asChild className="w-full">
        <Link href={nextStepHref}>Continue with {nextStepTitle}</Link>
      </Button>
    );
  }

  const dialog = dialogOpen ? (
    <FheEnrollmentDialog
      hasPasskeys={hasPasskeys}
      hasPassword={hasPassword}
      onOpenChange={setDialogOpen}
      open={dialogOpen}
      wallet={wallet}
    />
  ) : null;

  const button = (
    <Button
      className="w-full"
      onClick={handleOpen}
      onFocus={preloadDialog}
      onMouseEnter={preloadDialog}
    >
      Get Started
    </Button>
  );

  if (wallet) {
    return (
      <Web3Provider cookies={cookies}>
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

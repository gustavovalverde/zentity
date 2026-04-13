"use client";

import type { CountryDocumentEntry } from "@/lib/identity/verification/zkpassport-registry";

import { Camera, FileText, ImageUp, Nfc, SmartphoneNfc } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { CountryDocumentSelector } from "./country-document-selector";
import { DownloadZkPassportDialog } from "./download-zkpassport-dialog";

// Support level thresholds (match @zkpassport/registry's DocumentSupport enum)
const GOOD_SUPPORT = 0.75;
const TENTATIVE_SUPPORT = 0.25;

interface VerificationMethodCardsProps {
  countries: CountryDocumentEntry[];
  onSelectDocument?: () => void;
  onSelectPassportChip?: () => void;
  zkPassportEnabled: boolean;
}

export function VerificationMethodCards({
  countries,
  onSelectDocument,
  onSelectPassportChip,
  zkPassportEnabled,
}: Readonly<VerificationMethodCardsProps>) {
  const [supportLevel, setSupportLevel] = useState<number | null>(null);

  const countrySelected = supportLevel !== null;
  const nfcAvailable = countrySelected && supportLevel > 0;
  const nfcRecommended = nfcAvailable && supportLevel >= GOOD_SUPPORT;
  const nfcPartial =
    nfcAvailable &&
    supportLevel >= TENTATIVE_SUPPORT &&
    supportLevel < GOOD_SUPPORT;

  return (
    <div className="space-y-5">
      {zkPassportEnabled && (
        <CountryDocumentSelector
          countries={countries}
          onSupportChange={setSupportLevel}
        />
      )}

      {zkPassportEnabled && !countrySelected && (
        <div className="space-y-1 text-center text-sm">
          <p className="text-muted-foreground">
            Select your country to see verification options
          </p>
          <button
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setSupportLevel(0)}
            type="button"
          >
            Country not listed? Use Document Scan
          </button>
        </div>
      )}

      {nfcAvailable && (
        <>
          <NfcMethodSection
            highlighted={nfcRecommended}
            onSelect={onSelectPassportChip}
            partial={nfcPartial}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
        </>
      )}

      {(!zkPassportEnabled || countrySelected) && (
        <DocumentScanMethodSection
          highlighted={countrySelected && !nfcAvailable}
          isAlternative={nfcAvailable}
          onSelect={onSelectDocument}
        />
      )}
    </div>
  );
}

function NfcMethodSection({
  highlighted,
  onSelect,
  partial,
}: Readonly<{
  highlighted: boolean;
  onSelect?: (() => void) | undefined;
  partial: boolean;
}>) {
  return (
    <div
      className={cn(
        "space-y-4 rounded-lg border p-5 transition-colors",
        highlighted && "border-primary/50 bg-primary/5",
        partial && "border-warning/50 bg-warning/5"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Nfc className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">NFC Chip Verification</p>
            <p className="text-muted-foreground text-xs">
              Strongest verification
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {highlighted && <Badge variant="default">Recommended</Badge>}
          <Badge variant="info">Chip Verified</Badge>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Read the cryptographic chip embedded in your document using the
        ZKPassport app. Generates zero-knowledge proofs directly on your phone.
      </p>

      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          You&apos;ll need
        </p>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <SmartphoneNfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <strong>ZKPassport app</strong> on your phone (
              <DownloadZkPassportDialog />)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Nfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              NFC-enabled{" "}
              <strong>passport, national ID, or residence permit</strong>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <SmartphoneNfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              Phone <strong>NFC</strong> enabled
            </span>
          </li>
        </ul>
      </div>

      {onSelect ? (
        <Button className="w-full" onClick={onSelect} size="lg">
          Start NFC Verification
        </Button>
      ) : (
        <Button asChild className="w-full" size="lg">
          <Link href="/dashboard/verify">Start NFC Verification</Link>
        </Button>
      )}
    </div>
  );
}

function DocumentScanMethodSection({
  isAlternative,
  highlighted,
  onSelect,
}: Readonly<{
  isAlternative: boolean;
  highlighted: boolean;
  onSelect?: (() => void) | undefined;
}>) {
  return (
    <div
      className={cn(
        "space-y-4 rounded-lg border p-5 transition-colors",
        highlighted && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">Document Scan</p>
            <p className="text-muted-foreground text-xs">
              {isAlternative
                ? "For documents without NFC"
                : "Photo upload + liveness check"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {highlighted && <Badge variant="default">Recommended</Badge>}
          <Badge variant="outline">Verified</Badge>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Upload a photo of your government-issued document and complete a
        liveness check to verify you&apos;re the document holder.
      </p>

      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          You&apos;ll need
        </p>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <ImageUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              A <strong>photo</strong> of your government-issued ID
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <strong>Camera access</strong> for liveness verification
            </span>
          </li>
        </ul>
      </div>

      {onSelect ? (
        <Button
          className="w-full"
          onClick={onSelect}
          size={isAlternative ? "default" : "lg"}
          variant={isAlternative ? "outline" : "default"}
        >
          {isAlternative
            ? "My document doesn't have NFC"
            : "Start Document Scan"}
        </Button>
      ) : (
        <Button
          asChild
          className="w-full"
          size={isAlternative ? "default" : "lg"}
          variant={isAlternative ? "outline" : "default"}
        >
          <Link href="/dashboard/verify">
            {isAlternative
              ? "My document doesn't have NFC"
              : "Start Document Scan"}
          </Link>
        </Button>
      )}
    </div>
  );
}

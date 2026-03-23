"use client";

import {
  ArrowLeft01Icon,
  Shield01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";
import { ClaimList } from "@/components/veripass/claim-list";
import { CredentialCard } from "@/components/veripass/credential-card";
import { PresentationResult } from "@/components/veripass/presentation-result";
import { VerifierScenarios } from "@/components/veripass/verifier-scenarios";
import { VeriPassHeader } from "@/components/veripass/veripass-header";
import type { VerifierScenario } from "@/data/veripass";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { env } from "@/lib/env";
import { getScenario } from "@/lib/scenarios";
import {
  clearCredential,
  createPresentation,
  decodeClaims,
  getPresentableKeys,
  loadCredential,
  type StoredCredential,
  saveCredential,
  verifyPresentation,
} from "@/lib/wallet";

const scenario = getScenario("veripass");

type WalletState =
  | { phase: "empty" }
  | { phase: "issuing" }
  | {
      phase: "wallet";
      stored: StoredCredential;
      claims: Record<string, unknown>;
      presentableKeys: string[];
    }
  | {
      phase: "presenting";
      stored: StoredCredential;
      claims: Record<string, unknown>;
      presentableKeys: string[];
      verifier: VerifierScenario;
      selectedClaims: Set<string>;
    }
  | {
      phase: "result";
      verifier: VerifierScenario;
      disclosedClaims: Record<string, unknown>;
      totalClaims: number;
    };

export default function VeriPassPage() {
  const { session, isPending, isAuthenticated, handleSignIn, handleSignOut } =
    useOAuthFlow(scenario);

  const [dcrReady, setDcrReady] = useState(false);
  const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

  const [walletState, setWalletState] = useState<WalletState>({
    phase: "empty",
  });
  const [error, setError] = useState<string | null>(null);

  // Load stored credential on mount
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const stored = loadCredential();
    if (!stored) {
      setWalletState({ phase: "empty" });
      return;
    }
    decodeClaims(stored.credential)
      .then(async (claims) => {
        const presentableKeys = await getPresentableKeys(stored.credential);
        setWalletState({ phase: "wallet", stored, claims, presentableKeys });
      })
      .catch(() => {
        clearCredential();
        setWalletState({ phase: "empty" });
      });
  }, [isAuthenticated]);

  const handleImportOffer = useCallback(async (offerUri: string) => {
    setWalletState({ phase: "issuing" });
    setError(null);
    try {
      const res = await fetch("/api/veripass/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerUri }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error || `Issuance failed: ${res.status}`);
      }
      const { credential, issuer, holderPublicJwk, holderPrivateJwk } =
        (await res.json()) as {
          credential: string;
          issuer: string;
          holderPublicJwk: JsonWebKey;
          holderPrivateJwk: JsonWebKey;
        };

      const stored: StoredCredential = {
        credential,
        issuer,
        holderPublicJwk,
        holderPrivateJwk,
        createdAt: Date.now(),
      };
      saveCredential(stored);

      const claims = await decodeClaims(credential);
      const presentableKeys = await getPresentableKeys(credential);
      setWalletState({ phase: "wallet", stored, claims, presentableKeys });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Credential import failed");
      setWalletState({ phase: "empty" });
    }
  }, []);

  const handleSelectVerifier = useCallback(
    (verifier: VerifierScenario) => {
      if (walletState.phase !== "wallet") {
        return;
      }
      const { stored, claims, presentableKeys } = walletState;
      const selectedClaims = new Set(
        verifier.requiredClaims.filter((k) => presentableKeys.includes(k))
      );
      setWalletState({
        phase: "presenting",
        stored,
        claims,
        presentableKeys,
        verifier,
        selectedClaims,
      });
    },
    [walletState]
  );

  const handleToggleClaim = useCallback(
    (key: string) => {
      if (walletState.phase !== "presenting") {
        return;
      }
      const next = new Set(walletState.selectedClaims);
      if (walletState.verifier.requiredClaims.includes(key)) {
        return;
      }
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      setWalletState({ ...walletState, selectedClaims: next });
    },
    [walletState]
  );

  const handlePresent = useCallback(async () => {
    if (walletState.phase !== "presenting") {
      return;
    }
    setError(null);
    try {
      const presentation = await createPresentation(
        walletState.stored.credential,
        [...walletState.selectedClaims]
      );
      const disclosedClaims = await verifyPresentation(presentation);
      const metaKeys = new Set([
        "iss",
        "sub",
        "aud",
        "exp",
        "iat",
        "nbf",
        "jti",
        "cnf",
        "vct",
        "status",
        "_sd_alg",
      ]);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(disclosedClaims)) {
        if (!metaKeys.has(k)) {
          filtered[k] = v;
        }
      }
      setWalletState({
        phase: "result",
        verifier: walletState.verifier,
        disclosedClaims: filtered,
        totalClaims: walletState.presentableKeys.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Presentation failed");
    }
  }, [walletState]);

  const handleBackToWallet = useCallback(() => {
    const stored = loadCredential();
    if (!stored) {
      setWalletState({ phase: "empty" });
      return;
    }
    decodeClaims(stored.credential)
      .then(async (claims) => {
        const presentableKeys = await getPresentableKeys(stored.credential);
        setWalletState({ phase: "wallet", stored, claims, presentableKeys });
      })
      .catch(() => setWalletState({ phase: "empty" }));
  }, []);

  const handleFullSignOut = useCallback(async () => {
    clearCredential();
    await handleSignOut();
  }, [handleSignOut]);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        data-theme="veripass"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="font-medium text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen flex-col bg-background font-sans selection:bg-primary/10"
        data-theme="veripass"
      >
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
          <div className="absolute top-6 right-6">
            <Link
              className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
              href="/"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              Demos
            </Link>
          </div>

          <div className="relative z-10 w-full max-w-md space-y-8 text-center">
            <div className="mx-auto mb-4 flex size-24 items-center justify-center rounded-full bg-card shadow-primary/5 shadow-xl">
              <HugeiconsIcon
                className="text-primary"
                icon={Wallet01Icon}
                size={48}
              />
            </div>

            <div className="space-y-4">
              <h1 className="font-bold text-3xl text-foreground tracking-tight md:text-4xl">
                Digital Credential Wallet
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                eIDAS 2.0 requires that users control which attributes they
                share with each verifier. Receive one verifiable credential,
                then selectively disclose different claims to different parties.
                Only disclosed claims are visible; everything else remains
                cryptographically hidden.
              </p>
            </div>

            <div className="space-y-6 pt-4">
              <DcrRegistration
                clientName={scenario.dcr.clientName}
                defaultScopes={scenario.dcr.defaultScopes}
                onRegistered={handleDcrRegistered}
                providerId={scenario.id}
              />
              <Button
                className="h-14 w-full gap-3 bg-primary font-medium text-lg shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl"
                disabled={!dcrReady}
                onClick={handleSignIn}
                size="lg"
              >
                <HugeiconsIcon icon={Shield01Icon} size={20} />
                Connect with Zentity
              </Button>

              <div className="grid grid-cols-3 gap-3 text-muted-foreground text-xs">
                {[
                  "Receive credential",
                  "Choose what to share",
                  "Prove selectively",
                ].map((step, i) => (
                  <div
                    className="rounded-lg border bg-card p-3 text-center shadow-sm"
                    key={step}
                  >
                    <div className="mb-1 font-bold text-primary">{i + 1}</div>
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      data-theme="veripass"
    >
      <VeriPassHeader
        hasCredential={walletState.phase !== "empty"}
        onSignOut={handleFullSignOut}
        userEmail={session?.user.email}
      />

      <main className="container mx-auto flex-1 px-6 py-8">
        <div className="mx-auto max-w-2xl space-y-8">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
              {error}
            </div>
          )}

          {walletState.phase === "empty" && (
            <EmptyWallet onImport={handleImportOffer} />
          )}

          {walletState.phase === "issuing" && <IssuingState />}

          {walletState.phase === "wallet" && (
            <>
              <CredentialCard
                claimCount={walletState.presentableKeys.length}
                issuedAt={walletState.stored.createdAt}
                issuer={walletState.stored.issuer}
              />
              <div className="space-y-2">
                <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">
                  Credential Claims
                </h3>
                <ClaimList
                  claims={walletState.claims}
                  onToggle={Function.prototype as () => void}
                  presentableKeys={walletState.presentableKeys}
                  selectedClaims={new Set(walletState.presentableKeys)}
                />
              </div>
              <VerifierScenarios
                onSelect={handleSelectVerifier}
                presentableKeys={walletState.presentableKeys}
              />
            </>
          )}

          {walletState.phase === "presenting" && (
            <PresentingState
              onCancel={handleBackToWallet}
              onPresent={handlePresent}
              onToggle={handleToggleClaim}
              walletState={walletState}
            />
          )}

          {walletState.phase === "result" && (
            <PresentationResult
              disclosedClaims={walletState.disclosedClaims}
              onBack={handleBackToWallet}
              totalClaims={walletState.totalClaims}
              verifier={walletState.verifier}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyWallet({ onImport }: { onImport: (offerUri: string) => void }) {
  const [offerUri, setOfferUri] = useState("");

  const handleSubmit = useCallback(() => {
    if (!offerUri.trim()) {
      return;
    }
    onImport(offerUri);
  }, [offerUri, onImport]);

  return (
    <div className="space-y-8 py-8">
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-muted">
          <HugeiconsIcon
            className="text-muted-foreground"
            icon={Wallet01Icon}
            size={36}
          />
        </div>
        <div className="space-y-2">
          <h2 className="font-bold text-2xl">Your Wallet is Empty</h2>
          <p className="mx-auto max-w-md text-muted-foreground">
            To receive a verifiable credential, go to your{" "}
            <a
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              href={`${env.NEXT_PUBLIC_ZENTITY_URL}/dashboard/credentials`}
              rel="noopener noreferrer"
              target="_blank"
            >
              Zentity Dashboard &rarr; Credentials
            </a>{" "}
            and click <strong>Get Credential</strong>. Then paste the credential
            offer URI below.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-3">
        <label
          className="font-medium text-foreground text-sm"
          htmlFor="offer-uri"
        >
          Credential Offer
        </label>
        <textarea
          className="w-full resize-none rounded-lg border bg-card px-4 py-3 font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
          id="offer-uri"
          onChange={(e) => setOfferUri(e.target.value)}
          placeholder="openid-credential-offer://?credential_offer=..."
          rows={3}
          value={offerUri}
        />
        <Button
          className="w-full gap-2 shadow-lg transition-all hover:shadow-xl"
          disabled={!offerUri.trim()}
          onClick={handleSubmit}
          size="lg"
        >
          <HugeiconsIcon icon={Shield01Icon} size={18} />
          Import Credential
        </Button>
      </div>
    </div>
  );
}

function IssuingState() {
  return (
    <div className="space-y-6 py-12 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/10">
        <div className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
      <div className="space-y-2">
        <h2 className="font-bold text-2xl">Receiving Credential</h2>
        <p className="text-muted-foreground">
          Exchanging credential offer via OID4VCI...
        </p>
      </div>
    </div>
  );
}

function PresentingState({
  walletState,
  onToggle,
  onPresent,
  onCancel,
}: {
  walletState: Extract<WalletState, { phase: "presenting" }>;
  onToggle: (key: string) => void;
  onPresent: () => void;
  onCancel: () => void;
}) {
  const { verifier, claims, presentableKeys, selectedClaims } = walletState;
  const privacyPercent = Math.round(
    ((presentableKeys.length - selectedClaims.size) / presentableKeys.length) *
      100
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="font-bold text-xl">Present to {verifier.name}</h2>
        <p className="text-muted-foreground text-sm">
          {verifier.description}. Select which claims to share.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Privacy level</span>
          <span className="font-bold">
            {selectedClaims.size} of {presentableKeys.length} claims shared
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success transition-all duration-300"
            style={{ width: `${privacyPercent}%` }}
          />
        </div>
      </div>

      <ClaimList
        claims={claims}
        onToggle={onToggle}
        presentableKeys={presentableKeys}
        requiredClaims={verifier.requiredClaims}
        selectedClaims={selectedClaims}
      />

      <div className="flex gap-3">
        <Button className="flex-1" onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button className="flex-1" onClick={onPresent}>
          Present Credential
        </Button>
      </div>
    </div>
  );
}

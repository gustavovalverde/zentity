"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { DemoScenario } from "@/lib/scenarios";
import { cn } from "@/lib/utils";

const CLAIM_EXPLANATIONS: Record<string, { label: string; explanation: string }> = {
  verification_level: {
    label: "Verification Level",
    explanation: "The assurance tier achieved (none, basic, full). Enables risk-based access control.",
  },
  verified: {
    label: "Verified",
    explanation: "Basic compliance gate confirming identity verification was completed.",
  },
  document_verified: {
    label: "Document Verified",
    explanation: "Government ID was validated for authenticity and not flagged as fraudulent.",
  },
  liveness_verified: {
    label: "Liveness Verified",
    explanation: "Real person was present during verification (anti-deepfake, anti-replay).",
  },
  age_proof_verified: {
    label: "Age Proof",
    explanation: "ZK proof that birthdate >= threshold. No actual birthdate revealed.",
  },
  doc_validity_proof_verified: {
    label: "Document Validity",
    explanation: "ZK proof that document is not expired. No expiry date revealed.",
  },
  nationality_proof_verified: {
    label: "Nationality Proof",
    explanation: "ZK proof that nationality is in approved country list. No specific country revealed.",
  },
  face_match_verified: {
    label: "Face Match",
    explanation: "ZK proof that selfie matches document photo. Neither image is shared.",
  },
};

function ClaimBadge({ claim }: { claim: string }) {
  const info = CLAIM_EXPLANATIONS[claim];
  return (
    <div className="group relative">
      <Badge variant="outline" className="cursor-help text-xs">
        {claim.replace(/_/g, " ")}
      </Badge>
      {info && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          <div className="font-medium text-slate-900">{info.label}</div>
          <div className="mt-1 text-slate-600">{info.explanation}</div>
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-white" />
        </div>
      )}
    </div>
  );
}

function TechnicalDetails({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium text-slate-700 hover:text-slate-900">
        {title}
      </summary>
      <div className="border-t border-slate-200 px-3 py-2 text-slate-600">
        {children}
      </div>
    </details>
  );
}

type DemoStatusResponse = {
  ok?: boolean;
  userId?: string;
  status?: {
    verification?: {
      verified: boolean;
      level: "none" | "basic" | "full";
      checks: Record<string, boolean>;
    };
    bundle?: {
      status: string | null;
      policyVersion: string | null;
      issuerId: string | null;
      attestationExpiresAt: string | null;
      fheStatus: string | null;
      fheError: string | null;
      updatedAt: string | null;
    } | null;
    document?: {
      id: string;
      verifiedAt: string | null;
      status: string;
      issuerCountry: string | null;
      documentType: string | null;
    } | null;
  };
};

type OfferResponse = {
  ok?: boolean;
  offerId?: string;
};

type RequestResponse = {
  ok?: boolean;
  request?: {
    id: string;
    status: "pending" | "verified" | "failed";
    requiredClaims: string[];
    nonce: string;
    result?: Record<string, unknown>;
  };
  requestId?: string;
};

const walletUrl =
  process.env.NEXT_PUBLIC_WALLET_URL ?? "http://localhost:3101";
const issuerPortalUrl =
  process.env.NEXT_PUBLIC_ZENTITY_BASE_URL ?? "http://localhost:3000";
const demoSubjectEmail =
  process.env.NEXT_PUBLIC_DEMO_SUBJECT_EMAIL ?? "demo-subject@zentity.dev";

export function ScenarioFlow({ scenario }: { scenario: DemoScenario }) {
  const [status, setStatus] = useState<DemoStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [request, setRequest] = useState<RequestResponse["request"] | null>(
    null
  );
  const [requestBusy, setRequestBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const walletOfferUrl = useMemo(() => {
    if (!offerId) return null;
    return `${walletUrl}/?offerId=${offerId}`;
  }, [offerId]);

  const walletRequestUrl = useMemo(() => {
    if (!request?.id) return null;
    return `${walletUrl}/?requestId=${request.id}`;
  }, [request]);

  const loadStatus = useCallback(async () => {
    try {
      setStatusError(null);
      const res = await fetch("/api/demo/status");
      const body = (await res.json()) as DemoStatusResponse;
      if (!res.ok) {
        throw new Error(body && "error" in body ? String(body.error) : "");
      }
      setStatus(body);
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Status unavailable"
      );
    }
  }, []);

  async function seedDemo() {
    setSeedBusy(true);
    setSeedError(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      await loadStatus();
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : "Seed failed");
    } finally {
      setSeedBusy(false);
    }
  }

  async function createOffer() {
    setOfferBusy(true);
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          credentialConfigurationId: "zentity_identity",
        }),
      });
      const body = (await res.json()) as OfferResponse;
      if (!res.ok) {
        throw new Error(body && "error" in body ? String(body.error) : "");
      }
      setOfferId(body.offerId ?? null);
    } catch (error) {
      console.error(error);
    } finally {
      setOfferBusy(false);
    }
  }

  async function createRequest() {
    setRequestBusy(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          requiredClaims: scenario.requiredClaims,
          purpose: scenario.purpose,
        }),
      });
      const body = (await res.json()) as RequestResponse;
      if (!res.ok || !body.request) {
        throw new Error("Unable to create request");
      }
      setRequest(body.request);
    } catch (error) {
      console.error(error);
    } finally {
      setRequestBusy(false);
    }
  }

  async function refreshRequest() {
    if (!request?.id) return;
    const res = await fetch(`/api/requests/${request.id}`);
    const body = (await res.json()) as RequestResponse;
    if (res.ok && body.request) {
      setRequest(body.request);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const verificationLevel = status?.status?.verification?.level ?? "none";
  const verificationChecks = status?.status?.verification?.checks ?? {};
  const fheStatus = status?.status?.bundle?.fheStatus ?? "unknown";

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/70 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {scenario.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {scenario.subtitle}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            Assurance: {scenario.assurance}
          </Badge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1.1fr_1fr]">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{scenario.purpose}</p>
            <div className="rounded-xl border border-dashed border-muted/60 bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Verification</Badge>
                <span className="text-sm text-muted-foreground">
                  Level: {verificationLevel}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {Object.entries(verificationChecks).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border border-muted/60 bg-white/50 px-2 py-1"
                  >
                    <span className="capitalize">
                      {key.replace(/_/g, " ")}
                    </span>
                    <span
                      className={
                        value ? "text-emerald-600" : "text-muted-foreground"
                      }
                    >
                      {value ? "pass" : "pending"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>FHE status</span>
                <span className="font-medium">{fheStatus}</span>
              </div>
              {statusError && (
                <p className="mt-2 text-xs text-destructive">{statusError}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadStatus}
                  data-testid="refresh-status"
                >
                  Refresh status
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={seedDemo}
                  disabled={seedBusy}
                  data-testid="seed-demo"
                >
                  {seedBusy ? "Seeding…" : "Seed demo identity"}
                </Button>
                <a
                  href={issuerPortalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ size: "sm", variant: "ghost" })
                  )}
                >
                  Open issuer portal
                </a>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Demo subject: <span className="font-medium">{demoSubjectEmail}</span>
              </p>
              {seedError && (
                <p className="mt-2 text-xs text-destructive">{seedError}</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-muted/40 bg-gradient-to-br from-white via-white/80 to-blue-50/60 p-4">
            <div className="flex items-center justify-between">
              <Badge className="bg-slate-900 text-white">
                {scenario.highlight}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This scenario issues a verifiable credential, lets the wallet
              selectively disclose only required fields, and verifies the
              presentation against issuer status and assurance rules.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {scenario.requiredClaims.map((claim) => (
                <ClaimBadge key={claim} claim={claim} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Hover over claims to see what each proves.
            </p>
          </div>
        </div>
      </Card>

      <Card className="border-white/10 bg-white/70 p-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Step 1 — Issue credential</h3>
            <p className="text-sm text-muted-foreground">
              Generate an OIDC4VCI pre-authorized offer.
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={createOffer}
            disabled={offerBusy}
            data-testid="create-offer"
          >
            {offerBusy ? "Creating…" : "Create offer"}
          </Button>
        </div>
        <Separator className="my-4" />
        {offerId ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">Offer ready</Badge>
            {walletOfferUrl && (
              <a
                href={walletOfferUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="open-wallet-offer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
              >
                Open wallet to issue
              </a>
            )}
            <span className="text-xs text-muted-foreground">
              Offer ID: {offerId}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No offer generated yet.
          </p>
        )}
        <TechnicalDetails title="What's happening technically?">
          <div className="space-y-2">
            <p>
              <strong>OIDC4VCI Pre-authorized Flow:</strong> The issuer creates a
              credential offer containing a pre-authorized code. This code can be
              exchanged for an access token without user interaction.
            </p>
            <p>
              <strong>Holder Binding:</strong> When the wallet claims the credential,
              it generates a key pair and proves ownership via a proof JWT. The
              credential is cryptographically bound to this holder key.
            </p>
            <p>
              <strong>SD-JWT Format:</strong> The credential uses Selective Disclosure
              JWT format—each claim can be independently revealed or hidden during
              presentation.
            </p>
          </div>
        </TechnicalDetails>
      </Card>

      <Card className="border-white/10 bg-white/70 p-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              Step 2 — Request presentation
            </h3>
            <p className="text-sm text-muted-foreground">
              Ask the wallet to disclose only required fields.
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={createRequest}
            disabled={requestBusy}
            data-testid="create-request"
          >
            {requestBusy ? "Creating…" : "Create request"}
          </Button>
        </div>
        <Separator className="my-4" />
        {request ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Request {request.status}</Badge>
              {walletRequestUrl && (
                <a
                  href={walletRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="open-wallet-request"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                >
                  Open wallet to present
                </a>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={refreshRequest}
                data-testid="refresh-request"
              >
                Refresh
              </Button>
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              {request.requiredClaims.map((claim) => (
                <ClaimBadge key={claim} claim={claim} />
              ))}
            </div>
            {request.status !== "pending" && (
              <div className="rounded-lg border border-muted/60 bg-white/60 p-3 text-xs">
                <div className="mb-2 font-medium text-emerald-700">
                  Verified — No PII transmitted
                </div>
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(request.result ?? {}, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No presentation request created yet.
          </p>
        )}
        <TechnicalDetails title="What's happening technically?">
          <div className="space-y-2">
            <p>
              <strong>OIDC4VP Presentation Request:</strong> The verifier creates a
              request specifying required claims and a nonce for replay protection.
            </p>
            <p>
              <strong>Selective Disclosure:</strong> The wallet filters the SD-JWT to
              include only the requested claims. Hidden claims remain cryptographically
              hidden—the verifier cannot infer them.
            </p>
            <p>
              <strong>Verification:</strong> The verifier validates the issuer signature,
              holder binding, claim presence, and checks the credential status list to
              ensure it hasn't been revoked.
            </p>
          </div>
        </TechnicalDetails>
      </Card>
    </div>
  );
}

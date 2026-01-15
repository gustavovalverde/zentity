"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { SDJwtInstance } from "@sd-jwt/core";
import type { JWK } from "jose";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type CredentialOffer = {
  credential_issuer: string;
  credential_configuration_ids?: string[];
  grants?: Record<
    string,
    {
      "pre-authorized_code"?: string;
      authorization_server?: string;
    }
  >;
};

type StoredCredential = {
  credential: string;
  issuer: string;
  holderPublicJwk: JWK;
  holderPrivateJwk: JWK;
  createdAt: number;
};

type PresentationRequest = {
  id: string;
  nonce: string;
  requiredClaims: string[];
  purpose: string;
};

const hubUrl =
  process.env.NEXT_PUBLIC_DEMO_HUB_URL ?? "http://localhost:3100";

const storageKey = "demo-wallet-credential";

const hasher = async (data: string | ArrayBuffer) => {
  const buffer =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return new Uint8Array(digest);
};

function readStoredCredential(): StoredCredential | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

function saveStoredCredential(value: StoredCredential) {
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function clearStoredCredential() {
  window.localStorage.removeItem(storageKey);
}

function getPreAuthorizedCode(offer: CredentialOffer) {
  const grant = offer.grants?.["urn:ietf:params:oauth:grant-type:pre-authorized_code"];
  return grant?.["pre-authorized_code"];
}

function WalletPageContent() {
  const searchParams = useSearchParams();
  const offerId = searchParams.get("offerId");
  const requestId = searchParams.get("requestId");
  // Support standard OIDC4VCI credential offer parameters
  const credentialOfferParam = searchParams.get("credential_offer");
  const credentialOfferUriParam = searchParams.get("credential_offer_uri");

  const [offer, setOffer] = useState<CredentialOffer | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [credential, setCredential] = useState<StoredCredential | null>(null);
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);
  const [presentableKeys, setPresentableKeys] = useState<string[]>([]);
  const [selectedClaims, setSelectedClaims] = useState<string[]>([]);
  const [request, setRequest] = useState<PresentationRequest | null>(null);
  const [presentStatus, setPresentStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const issuer = offer?.credential_issuer ?? credential?.issuer ?? null;

  const sdjwt = useMemo(() => new SDJwtInstance({ hasher }), []);

  useEffect(() => {
    const stored = readStoredCredential();
    if (stored) {
      setCredential(stored);
    }
  }, []);

  // Handle direct OIDC4VCI credential_offer parameter
  useEffect(() => {
    if (!credentialOfferParam) return;
    try {
      const parsed = JSON.parse(decodeURIComponent(credentialOfferParam)) as CredentialOffer;
      setOffer(parsed);
    } catch (error) {
      setOfferError(
        error instanceof Error ? error.message : "Invalid credential offer format"
      );
    }
  }, [credentialOfferParam]);

  // Handle OIDC4VCI credential_offer_uri parameter (fetch from URI)
  useEffect(() => {
    let cancelled = false;
    async function fetchOfferFromUri() {
      if (!credentialOfferUriParam) return;
      setOfferError(null);
      try {
        const res = await fetch(decodeURIComponent(credentialOfferUriParam));
        if (!res.ok) {
          throw new Error("Failed to fetch credential offer from URI");
        }
        const data = (await res.json()) as CredentialOffer;
        if (!cancelled) {
          setOffer(data);
        }
      } catch (error) {
        if (!cancelled) {
          setOfferError(
            error instanceof Error ? error.message : "Failed to fetch offer from URI"
          );
        }
      }
    }
    void fetchOfferFromUri();
    return () => {
      cancelled = true;
    };
  }, [credentialOfferUriParam]);

  // Handle Demo Hub offerId parameter (legacy flow)
  useEffect(() => {
    let cancelled = false;
    async function loadOffer() {
      if (!offerId) return;
      // Skip if we already have an offer from direct params
      if (credentialOfferParam || credentialOfferUriParam) return;
      setOfferError(null);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const res = await fetch(`${hubUrl}/api/offers/${offerId}`);
          if (!res.ok) {
            throw new Error("Offer not found");
          }
          const payload = (await res.json()) as {
            offer?: { offer?: CredentialOffer };
          };
          const data = payload.offer?.offer;
          if (!data) {
            throw new Error("Invalid offer response");
          }
          if (!cancelled) {
            setOffer(data);
          }
          return;
        } catch (error) {
          if (attempt === 4) {
            if (!cancelled) {
              setOfferError(
                error instanceof Error ? error.message : "Failed to fetch offer"
              );
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    void loadOffer();
    return () => {
      cancelled = true;
    };
  }, [offerId, credentialOfferParam, credentialOfferUriParam]);

  useEffect(() => {
    let cancelled = false;
    async function loadRequest() {
      if (!requestId) return;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const res = await fetch(`${hubUrl}/api/requests/${requestId}`);
          if (!res.ok) {
            throw new Error("Request not found");
          }
          const payload = (await res.json()) as {
            request?: PresentationRequest;
          };
          if (payload.request && !cancelled) {
            setRequest(payload.request);
          }
          return;
        } catch {
          if (attempt === 4) {
            if (!cancelled) {
              setRequest(null);
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    void loadRequest();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  useEffect(() => {
    async function resolveClaims() {
      if (!credential) return;
      const presentable = await sdjwt.presentableKeys(credential.credential);
      const resolvedClaims = (await sdjwt.getClaims(
        credential.credential
      )) as Record<string, unknown>;
      setPresentableKeys(presentable);
      setClaims(resolvedClaims);
      setSelectedClaims((prev) => (prev.length ? prev : presentable));
    }
    void resolveClaims();
  }, [credential, sdjwt]);

  useEffect(() => {
    if (request?.requiredClaims?.length && presentableKeys.length) {
      const filtered = request.requiredClaims.filter((key) =>
        presentableKeys.includes(key)
      );
      setSelectedClaims(filtered.length ? filtered : presentableKeys);
    }
  }, [request?.requiredClaims, presentableKeys]);

  async function issueCredential() {
    if (!offer) return;
    const preAuthorizedCode = getPreAuthorizedCode(offer);
    if (!preAuthorizedCode) {
      setOfferError("Missing pre-authorized code");
      return;
    }
    setBusy(true);
    setPresentStatus(null);
    try {
      const authServer =
        offer.grants?.[
          "urn:ietf:params:oauth:grant-type:pre-authorized_code"
        ]?.authorization_server ?? offer.credential_issuer;

      const tokenParams = new URLSearchParams();
      tokenParams.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:pre-authorized_code"
      );
      tokenParams.set("pre-authorized_code", preAuthorizedCode);
      tokenParams.set("client_id", "zentity-wallet");
      tokenParams.set(
        "resource",
        `${offer.credential_issuer}/oidc4vci/credential`
      );

      const bodyStr = tokenParams.toString();
      console.log("Token request URL:", `${authServer}/oauth2/token`);
      console.log("Token request body:", bodyStr);
      console.log("Body includes client_id:", bodyStr.includes("client_id"));
      const tokenRes = await fetch(`${authServer}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyStr,
      });
      console.log("Token response status:", tokenRes.status);
      if (!tokenRes.ok) {
        throw new Error(await tokenRes.text());
      }
      const tokenPayload = (await tokenRes.json()) as {
        access_token?: string;
        c_nonce?: string;
        authorization_details?: Array<{ credential_identifiers?: string[] }>;
      };
      if (!tokenPayload.access_token || !tokenPayload.c_nonce) {
        throw new Error("Token response missing access token or nonce");
      }

      const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
        extractable: true,
      });
      const holderPublicJwk = (await exportJWK(publicKey)) as JWK;
      const holderPrivateJwk = (await exportJWK(privateKey)) as JWK;

      const proofJwt = await new SignJWT({ nonce: tokenPayload.c_nonce })
        .setProtectedHeader({
          alg: "EdDSA",
          jwk: holderPublicJwk,
          typ: "openid4vci-proof+jwt",
        })
        .setIssuedAt()
        .setAudience(offer.credential_issuer)
        .sign(privateKey);

      const credentialRes = await fetch(
        `${offer.credential_issuer}/oidc4vci/credential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenPayload.access_token}`,
          },
          body: JSON.stringify({
            credential_configuration_id:
              offer.credential_configuration_ids?.[0],
            proofs: { jwt: [proofJwt] },
          }),
        }
      );
      if (!credentialRes.ok) {
        throw new Error(await credentialRes.text());
      }
      const credentialPayload = (await credentialRes.json()) as {
        // Draft 11/13 format (backwards compat) - used by better-auth
        credential?: string;
        format?: string;
        // Batch format - used by some OIDC4VCI implementations
        credentials?: Array<{ credential?: string }>;
      };
      // Support both Draft 11/13 single format and batch format
      const issued =
        credentialPayload.credential ??
        credentialPayload.credentials?.[0]?.credential;
      if (!issued) {
        throw new Error("Credential missing from response");
      }

      const stored: StoredCredential = {
        credential: issued,
        issuer: offer.credential_issuer,
        holderPublicJwk,
        holderPrivateJwk,
        createdAt: Date.now(),
      };
      saveStoredCredential(stored);
      setCredential(stored);
    } catch (error) {
      setOfferError(error instanceof Error ? error.message : "Issuance failed");
    } finally {
      setBusy(false);
    }
  }

  async function presentCredential() {
    if (!credential || !request) return;
    setBusy(true);
    setPresentStatus(null);
    try {
      const selected =
        selectedClaims.length > 0 ? selectedClaims : presentableKeys;
      const frame = selected.reduce<Record<string, boolean>>(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {}
      );
      const presented = await sdjwt.present(
        credential.credential,
        frame
      );

      const res = await fetch(
        `${hubUrl}/api/requests/${request.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vp_token: presented }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      setPresentStatus("Presentation accepted.");
    } catch (error) {
      setPresentStatus(
        error instanceof Error ? error.message : "Presentation failed"
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleClaim(key: string) {
    setSelectedClaims((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  }

  function resetWallet() {
    clearStoredCredential();
    setCredential(null);
    setClaims(null);
    setPresentableKeys([]);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_45%,#e2e8f0_100%)] px-6 py-12 text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Badge className="w-fit bg-slate-900 text-white">
            Demo Wallet
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your agent for controlling disclosure
          </h1>
          <p className="max-w-xl text-sm text-slate-600">
            This wallet is your personal agent. It stores credentials locally,
            lets you choose what to reveal, and proves you own the credential—all
            without sharing raw personal data.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Issuer: {issuer ?? "Awaiting offer"}
            </span>
            {credential && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                Credential stored locally
              </span>
            )}
          </div>
        </header>

        {/* How This Wallet Works */}
        <Card className="border-blue-100 bg-blue-50/50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
              ?
            </div>
            <div className="space-y-1 text-sm">
              <div className="font-medium text-slate-900">How selective disclosure works</div>
              <p className="text-slate-600">
                Your credential contains multiple claims (verified, age_proof, etc.). When a verifier
                requests specific claims, you choose which to reveal. Unrevealed claims stay hidden—the
                verifier cannot see or infer them.
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-white/20 bg-white/70 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Credential offer</h2>
              <p className="text-sm text-muted-foreground">
                Accept the pre-authorized offer from the issuer.
              </p>
            </div>
            <Button
              size="sm"
              onClick={issueCredential}
              disabled={busy || !offer}
              data-testid="issue-credential"
            >
              {busy ? "Issuing…" : "Issue credential"}
            </Button>
          </div>
          <Separator className="my-4" />
          {offer ? (
            <div className="text-xs text-muted-foreground">
              Credential issuer: {offer.credential_issuer}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              No offer loaded. Open from demo hub to continue.
            </div>
          )}
          {offerError && (
            <p className="mt-2 text-xs text-destructive">{offerError}</p>
          )}
        </Card>

        <Card className="border-white/20 bg-white/70 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Stored credential</h2>
              <p className="text-sm text-muted-foreground">
                Select what to disclose for the request.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={resetWallet}>
              Clear wallet
            </Button>
          </div>
          <Separator className="my-4" />
          {!credential ? (
            <p className="text-sm text-muted-foreground">
              No credential stored yet.
            </p>
          ) : (
            <div className="space-y-4" data-testid="stored-credential">
              <div className="flex flex-wrap gap-2 text-xs">
                {presentableKeys.map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-full border border-muted/70 bg-white/60 px-3 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={selectedClaims.includes(key)}
                      onChange={() => toggleClaim(key)}
                    />
                    {key}
                  </label>
                ))}
              </div>
              {claims && (
                <pre className="rounded-lg border border-muted/60 bg-white/80 p-3 text-xs text-muted-foreground">
                  {JSON.stringify(claims, null, 2)}
                </pre>
              )}
            </div>
          )}
        </Card>

        <Card className="border-white/20 bg-white/70 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Presentation request</h2>
              <p className="text-sm text-muted-foreground">
                Respond to the verifier with selective disclosure.
              </p>
            </div>
            <Button
              size="sm"
              onClick={presentCredential}
              disabled={busy || !credential || !request}
              data-testid="submit-presentation"
            >
              {busy ? "Submitting…" : "Submit presentation"}
            </Button>
          </div>
          <Separator className="my-4" />
          {request ? (
            <div
              className="space-y-3 text-sm"
              data-testid="presentation-request"
            >
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-medium text-slate-500">
                  VERIFIER REQUESTS
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.requiredClaims.map((claim) => (
                    <span
                      key={claim}
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                    >
                      {claim.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Purpose: {request.purpose}
                </p>
              </div>

              {credential && selectedClaims.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="mb-2 text-xs font-medium text-emerald-700">
                    YOU WILL REVEAL ({selectedClaims.length} claims)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedClaims.map((claim) => (
                      <span
                        key={claim}
                        className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs text-emerald-900"
                      >
                        {claim.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                  {presentableKeys.length > selectedClaims.length && (
                    <p className="mt-2 text-xs text-emerald-600">
                      {presentableKeys.length - selectedClaims.length} claims will remain hidden
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Open from demo hub to respond to a request.
            </p>
          )}
          {presentStatus && (
            <p className="mt-2 text-xs text-slate-700">{presentStatus}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function WalletPageFallback() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#f8fafc_45%,#e2e8f0_100%)] px-6 py-12 text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Badge className="w-fit bg-slate-900 text-white">Demo Wallet</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your agent for controlling disclosure
          </h1>
          <p className="text-sm text-slate-600">Loading wallet...</p>
        </header>
      </div>
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={<WalletPageFallback />}>
      <WalletPageContent />
    </Suspense>
  );
}

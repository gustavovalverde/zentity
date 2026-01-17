import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { DEMO_SCENARIOS } from "@/lib/scenarios";

const walletUrl =
  process.env.NEXT_PUBLIC_WALLET_URL ?? "http://localhost:3101";
const waltidWalletUrl =
  process.env.NEXT_PUBLIC_WALTID_WALLET_URL ?? "http://localhost:7101";

export default function Page() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#f8fafc_45%,#f1f5f9_100%)] px-6 py-16 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="bg-slate-900 text-white">Zentity Demo Hub</Badge>
            <Badge variant="outline">FHE + ZK + OIDC4VCI/VP/IDA</Badge>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Verify everything, reveal nothing
          </h1>
          <p className="max-w-2xl text-base text-slate-600">
            See how users can prove their identity for KYC without sharing
            sensitive documents. This demo shows the full credential issuance
            and presentation flow using industry-standard OIDC4VCI/VP protocols.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/exchange-kyc" className={buttonVariants()}>
              Launch Exchange Demo
            </Link>
            <Link
              href="/bank-onboarding"
              className={buttonVariants({ variant: "outline" })}
            >
              Launch Bank Demo
            </Link>
            <a
              href={walletUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost" })}
            >
              Demo Wallet
            </a>
            <a
              href={waltidWalletUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost" })}
            >
              walt.id Wallet
            </a>
          </div>
        </header>

        {/* How This Works Section */}
        <section className="rounded-2xl border border-slate-200/60 bg-white/50 p-6 backdrop-blur">
          <h2 className="mb-4 text-xl font-semibold">How This Works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-white/80 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                  1
                </span>
                <span className="font-medium">Issuer Verifies</span>
              </div>
              <p className="text-sm text-slate-600">
                Zentity verifies identity (document + liveness + ZK proofs) and
                issues a credential with derived claims—no raw PII stored.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white/80 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                  2
                </span>
                <span className="font-medium">Wallet Holds</span>
              </div>
              <p className="text-sm text-slate-600">
                Your wallet receives the credential via OIDC4VCI. It stays on
                your device—you control when and what to share.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-white/80 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                  3
                </span>
                <span className="font-medium">Verifier Validates</span>
              </div>
              <p className="text-sm text-slate-600">
                A bank or exchange requests specific claims. You selectively
                disclose only what&apos;s needed—they verify cryptographically.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 text-center text-sm text-slate-600">
            <strong>Selective Disclosure</strong>: Prove &quot;over 18&quot; without
            revealing your birthdate. Prove nationality without showing your
            passport number.
          </div>
        </section>

        {/* Why This Matters Section */}
        <section className="rounded-2xl border border-slate-200/60 bg-gradient-to-br from-blue-50/50 to-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Why This Matters</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <div className="font-medium text-slate-900">For Exchanges</div>
              <p className="text-sm text-slate-600">
                Meet AML requirements without storing passport copies. No breach
                liability, automated compliance.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-slate-900">For Users</div>
              <p className="text-sm text-slate-600">
                Control your data. Share only derived claims, not raw documents.
                One credential works everywhere.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-slate-900">For Banks</div>
              <p className="text-sm text-slate-600">
                GDPR-friendly verification. No PII storage means no data
                protection risk.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-medium text-slate-900">For Regulators</div>
              <p className="text-sm text-slate-600">
                Cryptographic proof of compliance. Audit-ready evidence without
                mass data collection.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {DEMO_SCENARIOS.map((scenario) => {
            const href =
              scenario.id === "exchange"
                ? "/exchange-kyc"
                : "/bank-onboarding";
            return (
              <Card
                key={scenario.id}
                className="border-white/30 bg-white/70 p-6 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.7)] backdrop-blur"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{scenario.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {scenario.subtitle}
                    </p>
                  </div>
                  <Badge variant="secondary">{scenario.assurance}</Badge>
                </div>
                <p className="mt-4 text-sm text-slate-600">
                  {scenario.purpose}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {scenario.requiredClaims.slice(0, 4).map((claim) => (
                    <Badge key={claim} variant="outline" className="text-xs">
                      {claim.replaceAll("_", " ")}
                    </Badge>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href={href}
                    className={buttonVariants({ size: "sm" })}
                  >
                    View flow
                  </Link>
                  <a
                    href={walletUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ size: "sm", variant: "ghost" })}
                  >
                    Demo Wallet
                  </a>
                  <a
                    href={waltidWalletUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ size: "sm", variant: "ghost" })}
                  >
                    walt.id
                  </a>
                </div>
              </Card>
            );
          })}
        </section>
      </div>
    </div>
  );
}

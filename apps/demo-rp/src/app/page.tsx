import {
  AiChat02Icon,
  BankIcon,
  BlockchainIcon,
  FlashIcon,
  Globe02Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { ComplianceBadges } from "@/components/shared/compliance-badges";
import { Card, CardContent } from "@/components/ui/card";
import { env } from "@/lib/env";
import { SCENARIOS as SOURCE_SCENARIOS } from "@/lib/scenarios";

interface LandingScenario {
  brandFont: string;
  brandName: string;
  brandSub: string;
  icon: IconSvgElement | null;
  id: string;
  title: string;
}

const LANDING_UI: LandingScenario[] = [
  {
    id: "bank",
    icon: BankIcon,
    brandName: "Velocity Private",
    brandSub: "Trusted Finance",
    brandFont: "font-serif tracking-wide font-medium",
    title: "Customer Due Diligence",
  },
  {
    id: "wine",
    icon: null,
    brandName: "Vino Delivery",
    brandSub: "Fine Goods",
    brandFont: "font-serif tracking-tight text-xl italic",
    title: "Age-Gated Delivery",
  },
  {
    id: "exchange",
    icon: FlashIcon,
    brandName: "NOVAX",
    brandSub: "Global Markets",
    brandFont: "font-mono tracking-tighter font-bold uppercase",
    title: "Crypto-Asset KYC",
  },
  {
    id: "x402",
    icon: BlockchainIcon,
    brandName: "x402",
    brandSub: "Machine Commerce",
    brandFont: "font-mono tracking-tight font-bold",
    title: "Machine-to-Machine Compliance",
  },
  {
    id: "veripass",
    icon: Wallet01Icon,
    brandName: "VeriPass",
    brandSub: "Digital Credentials",
    brandFont: "font-bold tracking-tight",
    title: "Selective Disclosure",
  },
  {
    id: "aether",
    icon: AiChat02Icon,
    brandName: "Aether AI",
    brandSub: "Personal Shopping Agent",
    brandFont: "font-bold tracking-tight",
    title: "AI Agent Checkout",
  },
  {
    id: "aid",
    icon: Globe02Icon,
    brandName: "Relief Global",
    brandSub: "Humanitarian Aid",
    brandFont: "font-bold tracking-tight",
    title: "Humanitarian Verification",
  },
];

const SCENARIOS = LANDING_UI.map((ui) => {
  const source = SOURCE_SCENARIOS[ui.id];
  if (!source) {
    throw new Error(`Unknown scenario: ${ui.id}`);
  }
  return {
    ...ui,
    href: `/${ui.id}`,
    theme: ui.id,
    description: source.description,
    compliance: source.compliance,
  };
});

function WineIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.118 3.118 0 01-2.22.92H9.69a3.118 3.118 0 01-2.22-.92L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5" />
    </svg>
  );
}

const FOOTER_SCENARIOS = Object.values(SOURCE_SCENARIOS).map((s) => ({
  label: s.name,
  href: `/${s.id}`,
}));

export default function Page() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground selection:bg-primary/10">
      <Nav />

      {/* Hero */}
      <section className="relative overflow-hidden px-4 pt-24 pb-10 md:px-6 md:pt-28 md:pb-12">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,oklch(0.9_0.04_220)_0%,transparent_42%),radial-gradient(circle_at_82%_84%,oklch(0.9_0.04_170)_0%,transparent_38%)]" />
        </div>

        <div className="mx-auto max-w-5xl space-y-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1 font-medium text-foreground text-sm backdrop-blur-sm">
            <span className="relative inline-flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-green-500/40" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            Zentity Demo Platform
          </div>

          <h1 className="font-display font-semibold text-5xl leading-[0.98] tracking-tight sm:text-7xl">
            Seamless Identity
            <br />
            <span className="text-muted-foreground">Built for Trust</span>
          </h1>

          <p className="landing-copy mx-auto max-w-2xl text-lg md:text-xl">
            Every demo below solves a real compliance obligation: age gates,
            KYC, sanctions screening, humanitarian aid. The user controls what
            is shared and when. A wine shop receives only &ldquo;yes, over
            18.&rdquo; A bank receives the name it needs for CDD. Each attribute
            requires explicit consent at the moment the obligation arises.
          </p>

          <div className="flex flex-col justify-center gap-3 pt-4 sm:flex-row">
            <a
              className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-7 font-medium text-base text-primary-foreground transition-colors hover:bg-primary/80"
              href={`${env.NEXT_PUBLIC_ZENTITY_URL}/sign-up?fresh=1`}
              rel="noopener noreferrer"
              target="_blank"
            >
              Create Your Zentity Account
              <svg
                aria-hidden="true"
                className="ml-2 size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M5 12h14m-7-7 7 7-7 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-background/80 px-7 font-medium text-base backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
              href="https://zentity.xyz"
              rel="noopener noreferrer"
              target="_blank"
            >
              What is Zentity?
            </a>
          </div>

          <p className="text-muted-foreground/70 text-sm">
            A Zentity account is required to try the demos.{" "}
            <a
              className="underline transition-colors hover:text-foreground"
              href="https://zentity.xyz"
              rel="noopener noreferrer"
              target="_blank"
            >
              New here? Start with the overview
            </a>
          </p>
        </div>
      </section>

      {/* Scenarios Grid */}
      <section className="px-4 pb-14 md:px-6 md:pb-16">
        <div className="landing-container">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.map((s) => (
              <Link className="group" href={s.href} key={s.href}>
                <Card className="h-full overflow-hidden border border-border bg-card transition-colors hover:border-primary/30">
                  <div
                    className="relative flex h-36 flex-col justify-between overflow-hidden bg-primary p-6 transition-all group-hover:brightness-110"
                    data-theme={s.theme}
                  >
                    <div className="relative z-10 flex items-center gap-3">
                      {s.icon ? (
                        <div className="flex size-10 items-center justify-center rounded bg-primary-foreground text-primary">
                          <HugeiconsIcon icon={s.icon} size={24} />
                        </div>
                      ) : (
                        <div className="text-primary-foreground">
                          <WineIcon className="size-10" />
                        </div>
                      )}
                      <span
                        className={`text-lg text-primary-foreground ${s.brandFont}`}
                      >
                        {s.brandName}
                      </span>
                    </div>
                    <div className="relative z-10 font-light text-primary-foreground/70 text-sm">
                      {s.brandSub}
                    </div>
                  </div>
                  <CardContent className="space-y-3 p-6">
                    <h3 className="font-bold text-xl">{s.title}</h3>
                    <p className="landing-body">{s.description}</p>
                    <div data-theme={s.theme}>
                      <ComplianceBadges compliance={s.compliance} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <span className="font-bold text-xl">Zentity</span>
              <p className="mt-4 text-muted-foreground text-sm">
                Verify facts, not identity. Powered by zero-knowledge proofs and
                fully homomorphic encryption.
              </p>
              <a
                aria-label="GitHub"
                className="mt-4 flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                href="https://github.com/gustavovalverde/zentity"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  aria-hidden="true"
                  className="size-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                <span className="sr-only">GitHub</span>
              </a>
            </div>

            <div>
              <h3 className="mb-4 font-semibold text-sm">Scenarios</h3>
              <ul className="space-y-3">
                {FOOTER_SCENARIOS.map((link) => (
                  <li key={link.href}>
                    <Link
                      className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                      href={link.href}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-4 font-semibold text-sm">Platform</h3>
              <ul className="space-y-3">
                <li>
                  <a
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href="https://zentity.xyz"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Zentity Home
                  </a>
                </li>
                <li>
                  <a
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href={`${env.NEXT_PUBLIC_ZENTITY_URL}/sign-up?fresh=1`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Create Account
                  </a>
                </li>
                <li>
                  <a
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href="https://zentity.xyz/docs/architecture"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Documentation
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-4 font-semibold text-sm">Legal</h3>
              <ul className="space-y-3">
                <li>
                  <a
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href="https://zentity.xyz/privacy"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a
                    className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href="https://zentity.xyz/terms"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-border border-t pt-8">
            <p className="text-center text-muted-foreground text-sm">
              &copy; {new Date().getFullYear()} Zentity. Licensed under{" "}
              <a
                className="underline transition-colors hover:text-foreground"
                href="https://osaasy.dev/"
                rel="noopener noreferrer"
                target="_blank"
              >
                O&apos;Saasy License
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

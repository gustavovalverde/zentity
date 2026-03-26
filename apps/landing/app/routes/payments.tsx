import {
  IconArrowRight,
  IconCheck,
  IconCode,
  IconCoin,
  IconLock,
  IconShieldCheck,
  IconShieldLock,
  IconUserCheck,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SemanticColor } from "@/lib/colors";
import { colorStyles } from "@/lib/colors";
import { iconSemanticColors } from "@/lib/icon-semantics";
import { cn } from "@/lib/utils";

export const meta: MetaFunction = () => [
  { title: "Verified Payments | Zentity" },
  {
    name: "description",
    content:
      "Zentity adds a compliance layer to x402 payment settlement through the Proof-of-Human token: a compact JWT that proves what the payer can do, not who they are.",
  },
];

const cm = "text-zinc-500";
const kw = "text-purple-400";
const fn = "text-blue-400";
const str = "text-emerald-400";
const prop = "text-sky-300";
const num = "text-amber-400";

function PageLayout({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="-translate-y-full fixed top-2 left-2 z-60 rounded-md bg-background px-3 py-2 text-sm shadow transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main-content" className="flex-1">
        <section className="landing-band-flat px-4 pt-24 pb-14 md:px-6 md:pt-28 md:pb-16">
          <div className="landing-container">
            <header className="mb-10 max-w-3xl">
              <h1 className="font-display font-semibold text-4xl leading-tight">
                {title}
              </h1>
              <p className="landing-copy mt-3">{description}</p>
            </header>
            {children}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function CodeWindow({
  filename,
  children,
}: {
  readonly filename: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex h-9 items-center gap-1.5 border-border border-b bg-muted/30 px-3">
        <div className="size-2.5 rounded-full bg-red-500/80" />
        <div className="size-2.5 rounded-full bg-yellow-500/80" />
        <div className="size-2.5 rounded-full bg-green-500/80" />
        <div className="ml-2 font-mono text-[11px] text-muted-foreground">
          {filename}
        </div>
      </div>
      <div className="overflow-x-auto bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
        <pre className="text-zinc-300">{children}</pre>
      </div>
    </div>
  );
}

function ComparisonVisual() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconCoin className={cn("size-5", colorStyles.amber.iconText)} />
            <h3 className="font-semibold">Standard x402</h3>
          </div>
          <div className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
            <pre className="text-zinc-300">
              <span className={cm}>{"// HTTP 402: payment terms\n"}</span>
              {"{\n"}
              {"  "}
              <span className={prop}>{'"accepts"'}</span>
              {": [{\n"}
              {"    "}
              <span className={prop}>{'"scheme"'}</span>
              {": "}
              <span className={str}>{'"exact"'}</span>
              {",\n"}
              {"    "}
              <span className={prop}>{'"network"'}</span>
              {": "}
              <span className={str}>{'"eip155:84532"'}</span>
              {",\n"}
              {"    "}
              <span className={prop}>{'"amount"'}</span>
              {": "}
              <span className={str}>{'"10000"'}</span>
              {",\n"}
              {"    "}
              <span className={prop}>{'"asset"'}</span>
              {": "}
              <span className={str}>{'"0x036CbD...USDC"'}</span>
              {",\n"}
              {"    "}
              <span className={prop}>{'"payTo"'}</span>
              {": "}
              <span className={str}>{'"0xmerchant..."'}</span>
              {"\n"}
              {"  }]\n"}
              {"}"}
            </pre>
          </div>
          <p className="landing-caption mt-3">Standard x402 payment terms.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconShieldCheck
              className={cn("size-5", iconSemanticColors.compliance)}
            />
            <h3 className="font-semibold">With compliance extension</h3>
          </div>
          <div className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
            <pre className="text-zinc-300">
              <span className={cm}>
                {"// HTTP 402: payment + compliance extension\n"}
              </span>
              {"{\n"}
              {"  "}
              <span className={prop}>{'"accepts"'}</span>
              {": [{ "}
              <span className={cm}>{"/* payment terms */"}</span>
              {" }],\n"}
              {"  "}
              <span className={prop}>{'"extensions"'}</span>
              {": {\n"}
              {"    "}
              <span className={prop}>{'"zentity"'}</span>
              {": {\n"}
              {"      "}
              <span className={prop}>{'"minComplianceLevel"'}</span>
              {": "}
              <span className={num}>{"2"}</span>
              {",\n"}
              {"      "}
              <span className={prop}>{'"pohIssuer"'}</span>
              {": "}
              <span className={str}>{'"/.well-known/proof-of-human"'}</span>
              {",\n"}
              {"      "}
              <span className={prop}>{'"identityRegistry"'}</span>
              {": "}
              <span className={str}>{'"0x7a3F..."'}</span>
              {"\n"}
              {"    }\n"}
              {"  }\n"}
              {"}"}
            </pre>
          </div>
          <p className="landing-caption mt-3">
            The same payment terms, plus a compliance extension declaring the
            required verification tier.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const FLOW_STEPS = [
  {
    title: "Client requests a resource",
    body: "POST to a protected endpoint, no credentials attached.",
  },
  {
    title: "Server responds 402",
    body: "Payment terms with a compliance extension declaring the required verification tier.",
  },
  {
    title: "Client acquires PoH token",
    body: "A DPoP-bound JWT from Zentity carrying tier, sybil status, and verification method.",
  },
  {
    title: "Client retries with proof",
    body: "Payment signature in the header, PoH token in the body.",
  },
  {
    title: "Server verifies and serves",
    body: "JWKS signature check, tier comparison, and optional on-chain lookup.",
  },
];

function FlowSection() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="font-semibold">The protocol in five steps</h3>
        <p className="landing-body mt-1">
          No new infrastructure is required: the resource server adds one
          extension field to its 402 response, and the client adds one token to
          the retry.
        </p>
        <div className="mt-4 space-y-4">
          {FLOW_STEPS.map((step, i) => (
            <div key={step.title} className="flex items-start gap-3">
              <Badge
                variant="outline"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs"
              >
                {i + 1}
              </Badge>
              <div>
                <p className="font-medium text-sm">{step.title}</p>
                <p className="landing-caption mt-0.5">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <CodeWindow filename="proof-of-human.jwt">
        <span className={cm}>
          {"// Proof-of-Human token: compact, no PII\n"}
        </span>
        {"{\n"}
        {"  "}
        <span className={prop}>{'"iss"'}</span>
        {": "}
        <span className={str}>{'"https://zentity.xyz"'}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"sub"'}</span>
        {": "}
        <span className={str}>{'"pairwise:8f3a...c7e1"'}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"exp"'}</span>
        {": "}
        <span className={num}>{"1711003600"}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"scope"'}</span>
        {": "}
        <span className={str}>{'"poh"'}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"poh"'}</span>
        {": {\n"}
        {"    "}
        <span className={prop}>{'"tier"'}</span>
        {": "}
        <span className={num}>{"3"}</span>
        {",\n"}
        {"    "}
        <span className={prop}>{'"verified"'}</span>
        {": "}
        <span className={num}>{"true"}</span>
        {",\n"}
        {"    "}
        <span className={prop}>{'"sybil_resistant"'}</span>
        {": "}
        <span className={num}>{"true"}</span>
        {",\n"}
        {"    "}
        <span className={prop}>{'"method"'}</span>
        {": "}
        <span className={str}>{'"nfc_chip"'}</span>
        {"\n"}
        {"  },\n"}
        {"  "}
        <span className={prop}>{'"cnf"'}</span>
        {": {\n"}
        {"    "}
        <span className={prop}>{'"jkt"'}</span>
        {": "}
        <span className={str}>{'"dpop-key-thumbprint"'}</span>
        {"\n"}
        {"  }\n"}
        {"}"}
      </CodeWindow>
    </div>
  );
}

const TIERS = [
  {
    title: "Public API",
    tier: "Payment only",
    tierColor: "amber" as SemanticColor,
    icon: IconCoin,
    example: "Weather data, public feeds, metered APIs",
    check: "Facilitator verifies payment signature",
    payerProves: "Valid USDC authorization",
  },
  {
    title: "Age-Gated Content",
    tier: "Tier 2+",
    tierColor: "pink" as SemanticColor,
    icon: IconUserCheck,
    example: "Market analytics, licensed content, age-restricted goods",
    check: "JWKS verification of PoH JWT + tier ≥ 2",
    payerProves: "Payment + Proof-of-Human token",
  },
  {
    title: "Regulated Finance",
    tier: "Tier 3 + on-chain",
    tierColor: "emerald" as SemanticColor,
    icon: IconShieldLock,
    example: "Cross-border settlement, DeFi, sanctions-sensitive APIs",
    check: "PoH JWT + IdentityRegistry.checkCompliance()",
    payerProves: "Payment + PoH + wallet attestation",
  },
];

function TierCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {TIERS.map((t) => (
        <Card key={t.title}>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between">
              <t.icon
                className={cn("size-5", colorStyles[t.tierColor].iconText)}
              />
              <Badge variant="outline">{t.tier}</Badge>
            </div>
            <h3 className="font-semibold">{t.title}</h3>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Use case
                </dt>
                <dd className="mt-0.5 text-sm text-foreground">{t.example}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payer proves
                </dt>
                <dd className="mt-0.5 text-sm text-foreground">
                  {t.payerProves}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Server checks
                </dt>
                <dd className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {t.check}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function VerificationPaths() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconCode className={cn("size-5", colorStyles.blue.iconText)} />
            <h3 className="font-semibold">HTTP verification</h3>
          </div>
          <p className="landing-body">
            The resource server fetches Zentity's JWKS once, then verifies every
            Proof-of-Human token locally without further API calls to Zentity.
          </p>
          <ul className="mt-4 space-y-2">
            {[
              "Standard JWKS discovery: the same mechanism as any OIDC provider",
              "EdDSA signatures: compact and fast to verify",
              "DPoP binding: proof-of-possession, not bearer",
              "Pairwise sub: no cross-RP correlation",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <IconCheck
                  className={cn(
                    "mt-1 size-4 shrink-0",
                    colorStyles.emerald.iconText,
                  )}
                />
                <span className="landing-body">{item}</span>
              </li>
            ))}
          </ul>
          <p className="landing-caption mt-4">
            Best for:{" "}
            <strong className="text-foreground">
              API gating, SaaS metering, content access
            </strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconLock className={cn("size-5", iconSemanticColors.lock)} />
            <h3 className="font-semibold">On-chain verification</h3>
          </div>
          <p className="landing-body mb-4">
            The facilitator contract calls{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              checkCompliance()
            </code>{" "}
            on the IdentityRegistry. FHEVM returns an encrypted boolean; the
            contract never sees the underlying data.
          </p>
          <div className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
            <pre className="text-zinc-300">
              <span className={cm}>
                {"// FHEVM — compliance check on-chain\n"}
              </span>
              <span className={kw}>{"function "}</span>
              <span className={fn}>{"settleWithCompliance"}</span>
              {"(\n"}
              {"  "}
              <span className={fn}>{"address"}</span>
              {" payer\n"}
              {") "}
              <span className={kw}>{"external returns"}</span>
              {" ("}
              <span className={fn}>{"ebool"}</span>
              {") {\n"}
              {"  "}
              <span className={cm}>
                {"// Encrypted — never reveals identity\n"}
              </span>
              {"  "}
              <span className={fn}>{"ebool"}</span>
              {" compliant = registry."}
              <span className={fn}>{"checkCompliance"}</span>
              {"(\n"}
              {"    payer, requiredLevel\n"}
              {"  );\n\n"}
              {"  "}
              <span className={cm}>
                {"// Conditional settlement via FHE\n"}
              </span>
              {"  "}
              <span className={fn}>{"euint64"}</span>
              {" actual = FHE."}
              <span className={fn}>{"select"}</span>
              {"(\n"}
              {"    compliant,\n"}
              {"    FHE."}
              <span className={fn}>{"asEuint64"}</span>
              {"(amount),\n"}
              {"    FHE."}
              <span className={fn}>{"asEuint64"}</span>
              {"("}
              <span className={num}>{"0"}</span>
              {")\n"}
              {"  );\n\n"}
              {"  "}
              <span className={kw}>{"return"}</span>
              {" compliant;\n"}
              {"}"}
            </pre>
          </div>
          <p className="landing-caption mt-3">
            Best for:{" "}
            <strong className="text-foreground">
              DeFi settlement, smart contract gating, trustless compliance
            </strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentConstraints() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="font-semibold">PACT capability grants</h3>
        <p className="landing-body mt-1">
          When an AI agent acquires payment authorization via CIBA, the human
          sets constraints that bind every subsequent transaction.
        </p>
        <ul className="mt-4 space-y-2">
          {[
            {
              label: "Per-request cap",
              body: "Maximum amount per individual x402 payment",
            },
            {
              label: "Daily aggregate",
              body: "Cumulative limit across all payments in 24 hours",
            },
            {
              label: "Network and asset",
              body: "Restrict to specific chains and stablecoins",
            },
            {
              label: "Cooldown",
              body: "Minimum interval between consecutive payments",
            },
          ].map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              <IconCheck
                className={cn(
                  "mt-1 size-4 shrink-0",
                  colorStyles.emerald.iconText,
                )}
              />
              <span className="landing-body">
                <strong>{item.label}:</strong> {item.body}
              </span>
            </li>
          ))}
        </ul>
        <p className="landing-caption mt-4">
          Constraints are enforced server-side via the usage ledger; the agent
          cannot bypass them even with a valid token.
        </p>
      </div>
      <CodeWindow filename="capability-grant.json">
        <span className={cm}>
          {"// PACT capability grant for x402 payments\n"}
        </span>
        {"{\n"}
        {"  "}
        <span className={prop}>{'"capability"'}</span>
        {": "}
        <span className={str}>{'"purchase"'}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"constraints"'}</span>
        {": {\n"}
        {"    "}
        <span className={prop}>{'"amount.value"'}</span>
        {": { "}
        <span className={prop}>{'"max"'}</span>
        {": "}
        <span className={num}>{"100"}</span>
        {" },\n"}
        {"    "}
        <span className={prop}>{'"amount.currency"'}</span>
        {": { "}
        <span className={prop}>{'"in"'}</span>
        {": ["}
        <span className={str}>{'"USD"'}</span>
        {"] },\n"}
        {"    "}
        <span className={prop}>{'"x402.network"'}</span>
        {": { "}
        <span className={prop}>{'"in"'}</span>
        {": ["}
        <span className={str}>{'"eip155:8453"'}</span>
        {"] },\n"}
        {"    "}
        <span className={prop}>{'"x402.dailyTotal"'}</span>
        {": { "}
        <span className={prop}>{'"max"'}</span>
        {": "}
        <span className={num}>{"50"}</span>
        {" }\n"}
        {"  },\n"}
        {"  "}
        <span className={prop}>{'"daily_limit_count"'}</span>
        {": "}
        <span className={num}>{"10"}</span>
        {",\n"}
        {"  "}
        <span className={prop}>{'"cooldown_sec"'}</span>
        {": "}
        <span className={num}>{"60"}</span>
        {"\n"}
        {"}"}
      </CodeWindow>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <PageLayout
      title="Verified Payments"
      description={
        <>
          Zentity adds a compliance layer to <strong>x402</strong> payment
          settlement. The <strong>Proof-of-Human</strong> token carries
          verification tier, sybil resistance, and method, bound to the payer's
          DPoP key, proving what they can do without revealing who they are.
        </>
      }
    >
      <div className="space-y-14">
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Composable compliance
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Payment settlement and compliance verification are separate concerns
            that compose through a single extension field. The x402 protocol
            handles settlement; Zentity provides a{" "}
            <strong>compliance extension</strong> that resource servers declare
            alongside payment terms, signaling what level of verification the
            payer needs to present.
          </p>
          <div className="mt-6">
            <ComparisonVisual />
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">
            From request to verified access
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            The <strong>Proof-of-Human</strong> endpoint issues a compact JWT
            carrying verification tier, sybil resistance, and method, bound to
            the requester's DPoP key. It contains no personal data; resource
            servers verify the signature locally via standard JWKS discovery.
          </p>
          <div className="mt-6">
            <FlowSection />
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">
            3 tiers, 1 protocol
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            All 3 tiers share the same HTTP extension mechanism. What varies is
            the <strong>required evidence</strong>: payment-only resources need
            no identity proof, age-gated resources verify a Proof-of-Human tier,
            and regulated resources add an on-chain attestation check.
          </p>
          <div className="mt-6">
            <TierCards />
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">
            2 verification paths
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            The same identity data supports 2 trust models.{" "}
            <strong>HTTP verification</strong> uses the Proof-of-Human JWT for
            lightweight API gating. <strong>On-chain verification</strong> uses
            FHEVM encrypted attributes for trustless smart contract settlement.
          </p>
          <div className="mt-6">
            <VerificationPaths />
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">
            Delegated payments, bounded risk
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            When an AI agent pays on a human's behalf,{" "}
            <strong>PACT capability grants</strong> constrain every dimension of
            the transaction: amount, currency, network, asset, and frequency.
            The human approves once; the constraints enforce continuously.
          </p>
          <div className="mt-6">
            <AgentConstraints />
          </div>
          <div className="mt-8 flex gap-3">
            <a
              href="https://demo.zentity.xyz/x402"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ size: "sm" }),
                "h-9 rounded-sm px-4",
              )}
            >
              Try the x402 demo
            </a>
            <Link
              to="/docs/agent-architecture"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-9 rounded-sm px-4",
              )}
            >
              Read the agent architecture
              <IconArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

import {
  IconArrowRight,
  IconBell,
  IconCheck,
  IconCode,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconRobot,
  IconShieldCheck,
  IconShieldHalf,
  IconUserShield,
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
  { title: "Agentic Authorization | Zentity" },
  {
    name: "description",
    content:
      "AI agents need human identity to complete tasks, but storing that identity creates liability. Zentity lets agents prove who they represent and what the human approved, without holding any personal data.",
  },
];

/* ─── Layout ─────────────────────────────────────────────── */

function PageLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
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

/* ─── MCP Code Window ────────────────────────────────────── */

const cm = "text-zinc-500";
const kw = "text-purple-400";
const fn = "text-blue-400";
const str = "text-emerald-400";
const prop = "text-sky-300";

function CodeWindow() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex h-9 items-center gap-1.5 border-border border-b bg-muted/30 px-3">
        <div className="size-2.5 rounded-full bg-red-500/80" />
        <div className="size-2.5 rounded-full bg-yellow-500/80" />
        <div className="size-2.5 rounded-full bg-green-500/80" />
        <div className="ml-2 font-mono text-[11px] text-muted-foreground">
          mcp-purchase.ts
        </div>
      </div>

      <div className="overflow-x-auto bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
        <pre className="text-zinc-300">
          <span className={cm}>
            {"// MCP tool: purchase() — human-in-the-loop approval"}
          </span>
          {"\n"}
          <span className={kw}>const</span> result ={" "}
          <span className={kw}>await</span> <span className={fn}>mcp</span>.
          <span className={fn}>callTool</span>(
          <span className={str}>{'"purchase"'}</span>, {"{"}
          {"\n"}
          {"  "}
          <span className={prop}>item</span>:{" "}
          <span className={str}>{'"Macallan 18 Double Cask"'}</span>,{"\n"}
          {"  "}
          <span className={prop}>amount</span>: {"{ "}
          <span className={prop}>value</span>:{" "}
          <span className={str}>{'"161.94"'}</span>,{" "}
          <span className={prop}>currency</span>:{" "}
          <span className={str}>{'"USD"'}</span>
          {" },"}
          {"\n"}
          {"  "}
          <span className={prop}>merchant</span>:{" "}
          <span className={str}>{'"Spirits & Co."'}</span>
          {"\n"}
          {"}"});{"\n\n"}
          <span className={cm}>
            {"// → Push notification sent to user's device"}
          </span>
          {"\n"}
          <span className={cm}>
            {'// → User reviews: "Purchase Macallan 18 for $161.94"'}
          </span>
          {"\n"}
          <span className={cm}>
            {"// → User taps Approve (or unlocks vault for identity scopes)"}
          </span>
          {"\n\n"}
          <span className={cm}>{"// Result includes delegated token"}</span>
          {"\n"}
          result.
          <span className={prop}>content</span>{" "}
          <span className={cm}>
            {"// { approved: true, token: { sub, act: { sub: agent } } }"}
          </span>
        </pre>
      </div>
    </div>
  );
}

/* ─── Comparison Visual ──────────────────────────────────── */

function ComparisonVisual() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconRobot className={cn("size-5", colorStyles.red.iconText)} />
            <h3 className="font-semibold">What agents get today</h3>
          </div>
          <div className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
            <pre className="text-zinc-300">
              {"{\n"}
              {"  "}
              <span className={str}>{'"name"'}</span>:{" "}
              <span className={str}>{'"Alice Johnson"'}</span>,{"\n"}
              {"  "}
              <span className={str}>{'"birthdate"'}</span>:{" "}
              <span className={str}>{'"1990-03-15"'}</span>,{"\n"}
              {"  "}
              <span className={str}>{'"address"'}</span>:{" "}
              <span className={str}>{'"123 Main St, NYC"'}</span>,{"\n"}
              {"  "}
              <span className={str}>{'"passport_number"'}</span>:{" "}
              <span className={str}>{'"AB1234567"'}</span>
              {"\n}"}
            </pre>
          </div>
          <p className="landing-caption mt-3">
            Full PII — stored, forwarded, breachable.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <IconShieldCheck
              className={cn("size-5", iconSemanticColors.shield)}
            />
            <h3 className="font-semibold">What agents get with Zentity</h3>
          </div>
          <div className="overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-[13px] leading-relaxed dark:bg-zinc-900">
            <pre className="text-zinc-300">
              {"{\n"}
              {"  "}
              <span className={str}>{'"age_verification"'}</span>:{" "}
              <span className={kw}>true</span>,{"\n"}
              {"  "}
              <span className={str}>{'"nationality_verified"'}</span>:{" "}
              <span className={kw}>true</span>,{"\n"}
              {"  "}
              <span className={str}>{'"document_verified"'}</span>:{" "}
              <span className={kw}>true</span>,{"\n"}
              {"  "}
              <span className={str}>{'"verification_level"'}</span>:{" "}
              <span className={str}>{'"full"'}</span>
              {"\n}"}
            </pre>
          </div>
          <p className="landing-caption mt-3">
            Zero-knowledge proofs — nothing to store, nothing to breach.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Scenario Cards ─────────────────────────────────────── */

const SCENARIOS = [
  {
    title: "Compliance check",
    tier: "Anonymous",
    tierColor: "purple" as SemanticColor,
    icon: IconShieldCheck,
    agentAction: "Agent checks if user meets KYC requirements",
    humanExperience: "Silent — no notification, no approval needed",
    rsPayload: '{ verified: true, level: "full" }',
  },
  {
    title: "Profile read",
    tier: "Registered",
    tierColor: "amber" as SemanticColor,
    icon: IconUserShield,
    agentAction: "Agent requests user's name and address",
    humanExperience: "Push notification — tap to approve, unlock vault",
    rsPayload: "{ name, address } (single-use, ephemeral)",
  },
  {
    title: "Age-restricted purchase",
    tier: "Attested",
    tierColor: "emerald" as SemanticColor,
    icon: IconLock,
    agentAction: "Agent buys spirits — needs age proof + identity",
    humanExperience: "Push + vault unlock — review purchase, prove age",
    rsPayload: "{ age_verification: true, act: { sub: agent } }",
  },
] as const;

function ScenarioCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {SCENARIOS.map((s) => (
        <Card key={s.title}>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between">
              <s.icon
                className={cn("size-5", colorStyles[s.tierColor].iconText)}
              />
              <Badge variant="outline">{s.tier}</Badge>
            </div>
            <h3 className="font-semibold">{s.title}</h3>
            <dl className="mt-3 space-y-2">
              <div>
                <dt className="landing-caption font-medium">Agent action</dt>
                <dd className="landing-body">{s.agentAction}</dd>
              </div>
              <div>
                <dt className="landing-caption font-medium">
                  Human experience
                </dt>
                <dd className="landing-body">{s.humanExperience}</dd>
              </div>
              <div>
                <dt className="landing-caption font-medium">
                  Resource server receives
                </dt>
                <dd className="font-mono text-xs text-muted-foreground">
                  {s.rsPayload}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Trust Tiers ────────────────────────────────────────── */

const TIERS = [
  {
    name: "Anonymous",
    color: "purple" as SemanticColor,
    icon: IconRobot,
    description:
      "No agent identity disclosed. The CIBA request has no Agent-Assertion.",
    autoActivates: "Compliance checks, read-only proof queries",
    howToGet: "No registration — any OAuth client",
  },
  {
    name: "Registered",
    color: "amber" as SemanticColor,
    icon: IconShieldHalf,
    description:
      "Agent host and session registered with Ed25519 keys. Amber trust badge.",
    autoActivates: "Purchase up to $100, profile read (with grant)",
    howToGet: "Register host + session via /api/auth/agent/*",
  },
  {
    name: "Attested",
    color: "emerald" as SemanticColor,
    icon: IconShieldCheck,
    description:
      "Host verified via OAuth-Client-Attestation from a trusted provider. Green trust badge.",
    autoActivates: "All registered capabilities + attestation-gated actions",
    howToGet: "Register with OAuth-Client-Attestation + PoP headers",
  },
] as const;

function TrustTiersSection() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {TIERS.map((t) => (
        <Card key={t.name}>
          <CardContent className="pt-6">
            <t.icon className={cn("size-5", colorStyles[t.color].iconText)} />
            <h3 className="mt-3 font-semibold">{t.name}</h3>
            <p className="landing-body mt-1">{t.description}</p>
            <dl className="mt-4 space-y-2 border-border border-t pt-3">
              <div>
                <dt className="landing-caption font-medium">Auto-activates</dt>
                <dd className="landing-body">{t.autoActivates}</dd>
              </div>
              <div>
                <dt className="landing-caption font-medium">How to get</dt>
                <dd className="landing-body">{t.howToGet}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── MCP + A2A Integration ──────────────────────────────── */

const MCP_TOOLS = [
  { name: "whoami", desc: "Get the authenticated user's identity claims" },
  { name: "my_proofs", desc: "List all proof claims for the current user" },
  {
    name: "check_compliance",
    desc: "Check if user meets compliance requirements",
  },
  { name: "purchase", desc: "Request CIBA approval for a purchase action" },
  {
    name: "request_approval",
    desc: "Request CIBA approval for a custom action",
  },
] as const;

function McpSection() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="font-semibold">MCP Tools</h3>
        <p className="landing-body mt-1">
          Five identity tools, available over HTTP (SSE) and stdio transports.
        </p>
        <ul className="mt-4 space-y-2">
          {MCP_TOOLS.map((tool) => (
            <li className="flex items-start gap-2" key={tool.name}>
              <code className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {tool.name}
              </code>
              <span className="landing-body">{tool.desc}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold">Discovery endpoints</h3>
        <p className="landing-body mt-1">
          Standard discovery for both MCP and A2A protocols.
        </p>
        <ul className="mt-4 space-y-3">
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /.well-known/oauth-authorization-server
            </code>
            <p className="landing-caption mt-0.5">
              OAuth 2.1 metadata (PAR, DPoP, CIBA grant types)
            </p>
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /.well-known/agent-configuration
            </code>
            <p className="landing-caption mt-0.5">
              Agent capabilities, approval URLs, trust tiers
            </p>
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              /.well-known/agent.json
            </code>
            <p className="landing-caption mt-0.5">
              A2A agent card — security scheme, supported protocols
            </p>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ─── Protocol Composition (condensed) ───────────────────── */

const SPECS = [
  {
    icon: IconCode,
    color: iconSemanticColors.developer,
    name: "First-Party Apps",
    spec: "draft-ietf-oauth-first-party-apps",
  },
  {
    icon: IconKey,
    color: iconSemanticColors.key,
    name: "DPoP sender binding",
    spec: "RFC 9449",
  },
  {
    icon: IconBell,
    color: iconSemanticColors.compliance,
    name: "CIBA per-action consent",
    spec: "OIDC CIBA Core",
  },
  {
    icon: IconPlugConnected,
    color: iconSemanticColors.oauth,
    name: "Rich Authorization Requests",
    spec: "RFC 9396",
  },
  {
    icon: IconCheck,
    color: colorStyles.amber.iconText,
    name: "Delegation proof (act claim)",
    spec: "RFC 8693",
  },
  {
    icon: IconLock,
    color: iconSemanticColors.lock,
    name: "Ephemeral identity delivery",
    spec: "Zentity userinfo",
  },
] as const;

function ProtocolComposition() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SPECS.map((s) => (
        <div
          className="flex items-start gap-3 rounded-lg border border-border p-3"
          key={s.name}
        >
          <s.icon className={cn("mt-0.5 size-4 shrink-0", s.color)} />
          <div>
            <p className="font-medium text-sm">{s.name}</p>
            <p className="landing-caption">{s.spec}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────── */

export default function AgentsPage() {
  return (
    <PageLayout
      title="Agentic Authorization"
      description="AI agents need human identity to complete tasks, but storing that identity creates liability. Zentity lets agents prove who they represent and what the human approved, without holding any personal data."
    >
      <div className="space-y-14">
        {/* Comparison Visual */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Identity without exposure
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Today, agents receive raw personal data. With Zentity, they receive
            cryptographic proofs that answer the question without revealing the
            answer.
          </p>
          <div className="mt-6">
            <ComparisonVisual />
          </div>
        </section>

        {/* How it works — MCP code + steps */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            From tool call to human approval
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            An MCP tool call triggers the human-in-the-loop flow. The agent
            never touches credentials — the human approves from their own
            device.
          </p>

          <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
            <div>
              <ul className="space-y-5">
                {[
                  {
                    title: "Agent calls MCP tool",
                    body: "The agent invokes purchase() with item, amount, and merchant. The MCP server translates this into a CIBA backchannel request.",
                  },
                  {
                    title: "Human receives notification",
                    body: "A push notification arrives showing the binding message and structured action details.",
                  },
                  {
                    title: "Review and approve",
                    body: "If identity scopes are requested, the human unlocks their vault with passkey, password, or wallet. PII is sealed client-side.",
                  },
                  {
                    title: "Agent receives delegated token",
                    body: "The token carries the act claim binding human to agent, DPoP sender constraint, and authorization_details.",
                  },
                ].map((step, i) => (
                  <li className="flex items-start gap-3" key={step.title}>
                    <Badge
                      variant="outline"
                      className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground"
                    >
                      {i + 1}
                    </Badge>
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="landing-body mt-1">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <CodeWindow />
          </div>
        </section>

        {/* Scenario Cards */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Three scenarios, three trust levels
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            The human experience differs based on what the agent needs and how
            much it's trusted. Higher trust means more capabilities activate
            automatically.
          </p>
          <div className="mt-6">
            <ScenarioCards />
          </div>
        </section>

        {/* Trust Tiers */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Agent trust tiers
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Trust is earned, not assumed. Each tier unlocks progressively more
            autonomous capabilities.
          </p>
          <div className="mt-6">
            <TrustTiersSection />
          </div>
        </section>

        {/* MCP + A2A Integration */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            MCP + A2A integration
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Identity as a tool, not a data dump. Agents discover capabilities
            through standard protocols.
          </p>
          <div className="mt-6">
            <McpSection />
          </div>
        </section>

        {/* Protocol Composition */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Six specs, one binding chain
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Each mechanism solves one dimension of the delegation problem. The
            composition, not any individual spec, is what makes agent-human
            identity work.
          </p>
          <div className="mt-6">
            <ProtocolComposition />
          </div>

          <div className="mt-8">
            <Link
              to="/docs/agent-architecture"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-9 rounded-sm px-4",
              )}
            >
              Read the full protocol documentation
              <IconArrowRight className="ml-2 size-4" />
            </Link>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

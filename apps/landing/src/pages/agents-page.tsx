import {
  IconArrowRight,
  IconBell,
  IconCheck,
  IconCode,
  IconFingerprint,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconRobot,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { colorStyles } from "@/lib/colors";
import { iconSemanticColors } from "@/lib/icon-semantics";
import { useDocumentHead } from "@/lib/use-document-head";
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

function PageLayout({ title, description, children }: PageLayoutProps) {
  useDocumentHead({
    title: `${title} | Zentity`,
    description,
  });

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

// Syntax token classes
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
          agent-ciba-flow.ts
        </div>
      </div>

      <div className="overflow-x-auto bg-zinc-950 p-4 text-[13px] leading-relaxed font-mono dark:bg-zinc-900">
        <pre className="text-zinc-300">
          <span className={cm}>
            {"// Step 1: Agent requests human approval via CIBA"}
          </span>
          {"\n"}
          <span className={kw}>const</span> ciba ={" "}
          <span className={kw}>await</span> <span className={fn}>fetch</span>(
          {"\n"}
          {"  "}
          <span className={str}>
            {'"https://app.zentity.xyz/api/auth/oauth2/bc-authorize"'}
          </span>
          ,{"\n"}
          {"  "}
          {"{ "}
          <span className={prop}>method</span>:{" "}
          <span className={str}>{'"POST"'}</span>,{" "}
          <span className={prop}>headers</span>: {"{ "}
          <span className={prop}>DPoP</span>: proof {"}"},{"\n"}
          {"    "}
          <span className={prop}>body</span>: <span className={kw}>new</span>{" "}
          URLSearchParams({"{"} {"\n"}
          {"      "}
          <span className={prop}>login_hint</span>: userId,{"\n"}
          {"      "}
          <span className={prop}>scope</span>:{" "}
          <span className={str}>
            {'"openid identity.name identity.address"'}
          </span>
          ,{"\n"}
          {"      "}
          <span className={prop}>binding_message</span>:{" "}
          <span className={str}>{'"Purchase Widget for $29.99"'}</span>,{"\n"}
          {"    "}
          {"})"}
          {" }"}){"\n\n"}
          <span className={cm}>
            {"// Step 2: Human receives push notification, approves"}
          </span>
          {"\n"}
          <span className={cm}>
            {"// Step 3: Poll for DPoP-bound token with delegation proof"}
          </span>
          {"\n"}
          <span className={cm}>
            {
              "// Token: { sub: user, act: { sub: agent }, authorization_details, release_handle }"
            }
          </span>
          {"\n\n"}
          <span className={cm}>
            {"// Step 4: Redeem release handle for one-time PII"}
          </span>
          {"\n"}
          <span className={kw}>const</span> release ={" "}
          <span className={kw}>await</span> <span className={fn}>fetch</span>(
          {"\n"}
          {"  "}
          <span className={str}>
            {'"https://app.zentity.xyz/api/oauth2/release"'}
          </span>
          ,{"\n"}
          {"  "}
          {"{ "}
          <span className={prop}>method</span>:{" "}
          <span className={str}>{'"POST"'}</span>,{" "}
          <span className={prop}>headers</span>: {"{"}
          {"\n"}
          {"    "}
          <span className={prop}>Authorization</span>:{" "}
          {/* biome-ignore lint/suspicious/noTemplateCurlyInString: syntax-highlighted code display */}
          <span className={str}>{"`DPoP ${cibaToken}`"}</span>,{"\n"}
          {"    "}
          <span className={prop}>DPoP</span>: proof,{"\n"}
          {"  "}
          {"}}"})
        </pre>
      </div>
    </div>
  );
}

export function AgentsPage() {
  return (
    <PageLayout
      title="Agentic Authorization"
      description="AI agents need human identity to complete tasks, but storing that identity creates liability. Zentity lets agents prove who they represent and what the human approved, without holding any personal data."
    >
      <div className="space-y-12">
        {/* The Delegation Gap */}
        <section>
          <div className="mb-6">
            <h2 className="font-display text-2xl font-semibold">
              Why standard OAuth breaks for agents
            </h2>
            <p className="landing-body mt-2 max-w-2xl">
              OAuth assumes the party receiving the token is the party who
              authenticated. When agent and human are different entities, the
              protocol must bind them together while keeping secrets out of the
              agent's reach.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <IconRobot
                    className={cn("size-5", colorStyles.red.iconText)}
                  />
                  <h3>Standard agent tokens</h3>
                </div>
                <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
                  The impersonation problem
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <IconX
                      className={cn(
                        "mt-1 size-4 shrink-0",
                        colorStyles.red.iconText,
                      )}
                    />
                    <span className="landing-body">
                      <strong>No delegation proof:</strong> The token identifies
                      the user but not which agent is acting. A stolen token
                      works for any client.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <IconX
                      className={cn(
                        "mt-1 size-4 shrink-0",
                        colorStyles.red.iconText,
                      )}
                    />
                    <span className="landing-body">
                      <strong>Blanket access:</strong> The agent receives all
                      consented scopes upfront. There is no per-action approval,
                      and no way to prove the human approved a specific
                      transaction.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <IconShieldCheck
                    className={cn("size-5", iconSemanticColors.shield)}
                  />
                  <h3>Zentity agentic auth</h3>
                </div>
                <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
                  Bound delegation
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <IconCheck
                      className={cn(
                        "mt-1 size-4 shrink-0",
                        colorStyles.emerald.iconText,
                      )}
                    />
                    <span className="landing-body">
                      <strong>Provable delegation:</strong> Every token carries
                      an{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        act
                      </code>{" "}
                      claim binding the human's identity to the acting agent.
                      Resource servers verify the delegation chain locally,
                      without contacting the authorization server.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <IconCheck
                      className={cn(
                        "mt-1 size-4 shrink-0",
                        colorStyles.emerald.iconText,
                      )}
                    />
                    <span className="landing-body">
                      <strong>Per-action consent:</strong> Each sensitive action
                      triggers a push notification. The human reviews the
                      specific request and approves from their device.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Protocol Composition */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Five specs, one binding chain
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Each mechanism solves one dimension of the delegation problem. The
            composition, not any individual spec, is what makes agent-human
            identity work.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <IconCode
                  className={cn("size-5", iconSemanticColors.developer)}
                />
                <h3 className="mt-3 font-semibold">Headless bootstrap</h3>
                <p className="landing-body mt-1">
                  The agent authenticates without a browser using the
                  First-Party App Challenge endpoint. No redirect flow, no
                  embedded browser.
                </p>
                <p className="landing-caption mt-2">
                  draft-ietf-oauth-first-party-apps
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconKey className={cn("size-5", iconSemanticColors.key)} />
                <h3 className="mt-3 font-semibold">Sender binding</h3>
                <p className="landing-body mt-1">
                  A DPoP keypair generated at startup threads through every
                  request. Stolen tokens are useless without the matching
                  private key.
                </p>
                <p className="landing-caption mt-2">RFC 9449 (DPoP)</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconBell
                  className={cn("size-5", iconSemanticColors.compliance)}
                />
                <h3 className="mt-3 font-semibold">Per-action consent</h3>
                <p className="landing-body mt-1">
                  CIBA sends a push notification for each sensitive action. The
                  human reviews and approves from their device, not from the
                  agent's interface.
                </p>
                <p className="landing-caption mt-2">OpenID Connect CIBA Core</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconPlugConnected
                  className={cn("size-5", iconSemanticColors.oauth)}
                />
                <h3 className="mt-3 font-semibold">Structured intent</h3>
                <p className="landing-body mt-1">
                  Rich Authorization Requests attach structured metadata (item,
                  amount, merchant) so the human approves the specific
                  transaction, not a generic capability.
                </p>
                <p className="landing-caption mt-2">RFC 9396 (RAR)</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconFingerprint
                  className={cn("size-5", colorStyles.amber.iconText)}
                />
                <h3 className="mt-3 font-semibold">Delegation proof</h3>
                <p className="landing-body mt-1">
                  The{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    act
                  </code>{" "}
                  claim in every token names both the human and the agent, with
                  pairwise identifiers that prevent cross-service tracking.
                </p>
                <p className="landing-caption mt-2">
                  RFC 8693 (Token Exchange)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconLock className={cn("size-5", iconSemanticColors.lock)} />
                <h3 className="mt-3 font-semibold">One-time PII release</h3>
                <p className="landing-body mt-1">
                  Identity is sealed with a release handle at approval time. The
                  agent redeems it once, the server marks it consumed. PII is
                  never stored in plaintext.
                </p>
                <p className="landing-caption mt-2">Zentity release handle</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* How It Works */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            From push notification to identity delivery
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            When an agent needs the human's name to complete a purchase, the
            entire flow takes three participants and five steps. The human's
            vault is unlocked client-side; the server never sees the decrypted
            profile.
          </p>

          <div className="mt-6 grid items-start gap-6 md:grid-cols-2">
            <div>
              <ul className="space-y-6">
                <li className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm">
                    1
                  </span>
                  <div>
                    <h3 className="font-semibold">Agent requests approval</h3>
                    <p className="landing-body mt-1">
                      The agent sends a CIBA backchannel request with the action
                      details, requested scopes, and a DPoP proof. The server
                      returns an{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        auth_req_id
                      </code>{" "}
                      and starts polling.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm">
                    2
                  </span>
                  <div>
                    <h3 className="font-semibold">
                      Human receives notification
                    </h3>
                    <p className="landing-body mt-1">
                      A push notification arrives on the human's device showing
                      the binding message and structured action details (e.g.,
                      "Purchase Widget from Acme for $29.99").
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm">
                    3
                  </span>
                  <div>
                    <h3 className="font-semibold">Vault unlock and staging</h3>
                    <p className="landing-body mt-1">
                      If identity scopes are requested, the human unlocks their
                      vault with their passkey, password, or wallet. The
                      decrypted PII is sealed with a random release handle and
                      stored as ciphertext.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm">
                    4
                  </span>
                  <div>
                    <h3 className="font-semibold">Token with release handle</h3>
                    <p className="landing-body mt-1">
                      The agent's next poll succeeds. The access token carries
                      the release handle (the decryption key), the{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        act
                      </code>{" "}
                      delegation claim, and DPoP binding.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm">
                    5
                  </span>
                  <div>
                    <h3 className="font-semibold">One-time redemption</h3>
                    <p className="landing-body mt-1">
                      The agent calls the release endpoint with its DPoP-bound
                      token. The server decrypts the PII, returns a fresh
                      id_token with name and address, and marks the approval as
                      redeemed.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <CodeWindow />
          </div>
        </section>

        {/* What resource servers see */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            What resource servers see
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            A resource server receiving a Zentity agent token can verify the
            delegation chain locally, without contacting the authorization
            server. Three properties distinguish a human-backed agent from a bot
            farm.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <IconFingerprint
                  className={cn("size-5", colorStyles.amber.iconText)}
                />
                <h3 className="mt-3 font-semibold">Delegation chain</h3>
                <p className="landing-body mt-1">
                  The token names the human (
                  <code className="font-mono text-xs">sub</code>) and the agent
                  (<code className="font-mono text-xs">act.sub</code>), with
                  pairwise identifiers so the same agent appears different to
                  each resource server.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconKey className={cn("size-5", iconSemanticColors.key)} />
                <h3 className="mt-3 font-semibold">DPoP sender constraint</h3>
                <p className="landing-body mt-1">
                  The token's <code className="font-mono text-xs">cnf.jkt</code>{" "}
                  binds it to a specific key. Stolen tokens are useless. Bot
                  farms would need unique key management per instance.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconShieldCheck
                  className={cn("size-5", iconSemanticColors.shield)}
                />
                <h3 className="mt-3 font-semibold">Action specificity</h3>
                <p className="landing-body mt-1">
                  <code className="font-mono text-xs">
                    authorization_details
                  </code>{" "}
                  carries exactly what the human approved. A blanket-scope token
                  without action metadata signals weaker authorization.
                </p>
              </CardContent>
            </Card>
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

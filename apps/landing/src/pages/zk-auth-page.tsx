import {
  IconArrowRight,
  IconCheck,
  IconCode,
  IconDatabaseOff,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconShieldCheck,
  IconShieldLock,
  IconUserCheck,
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
const cm = "text-zinc-500"; // comment
const kw = "text-purple-400"; // keyword
const fn = "text-blue-400"; // function/method
const str = "text-emerald-400"; // string
const num = "text-amber-400"; // number/boolean
const prop = "text-sky-300"; // property key

function CodeWindow({ filename }: { readonly filename: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      {/* macOS title bar */}
      <div className="flex h-9 items-center gap-1.5 border-border border-b bg-muted/30 px-3">
        <div className="size-2.5 rounded-full bg-red-500/80" />
        <div className="size-2.5 rounded-full bg-yellow-500/80" />
        <div className="size-2.5 rounded-full bg-green-500/80" />
        <div className="ml-2 font-mono text-[11px] text-muted-foreground">
          {filename}
        </div>
      </div>

      <div className="overflow-x-auto bg-zinc-950 p-4 text-[13px] leading-relaxed font-mono dark:bg-zinc-900">
        <pre className="text-zinc-300">
          <span className={cm}>
            {"// Step 1: Dynamic Client Registration (RFC 7591)"}
          </span>
          {"\n"}
          <span className={kw}>const</span> reg ={" "}
          <span className={kw}>await</span> <span className={fn}>fetch</span>(
          {"\n"}
          {"  "}
          <span className={str}>
            {'"https://app.zentity.xyz/api/auth/oauth2/register"'}
          </span>
          ,{"\n"}
          {"  "}
          {"{ "}
          <span className={prop}>method</span>:{" "}
          <span className={str}>{'"POST"'}</span>,{" "}
          <span className={prop}>body</span>: JSON.
          <span className={fn}>stringify</span>({"{"}
          {"\n"}
          {"    "}
          <span className={prop}>client_name</span>:{" "}
          <span className={str}>{'"My App"'}</span>,{"\n"}
          {"    "}
          <span className={prop}>redirect_uris</span>: [
          <span className={str}>{'"https://myapp.com/callback"'}</span>],
          {"\n"}
          {"    "}
          <span className={prop}>scope</span>:{" "}
          <span className={str}>{'"openid email proof:verification"'}</span>,
          {"\n"}
          {"    "}
          <span className={prop}>grant_types</span>: [
          <span className={str}>{'"authorization_code"'}</span>],{"\n"}
          {"    "}
          <span className={prop}>token_endpoint_auth_method</span>:{" "}
          <span className={str}>{'"none"'}</span>,{"\n"}
          {"  "}
          {"})"}
          {"}"}){"\n"}
          );{"\n"}
          <span className={kw}>const</span> {"{ "}
          <span className={prop}>client_id</span>
          {" }"} = <span className={kw}>await</span> reg.
          <span className={fn}>json</span>();{"\n"}
          {"\n"}
          <span className={cm}>
            {"// Step 2: Standard OIDC redirect with PKCE"}
          </span>
          {"\n"}
          <span className={cm}>
            {"// scope: openid email proof:verification"}
          </span>
          {"\n"}
          <span className={cm}>
            {"//   \u2192 returns boolean verification flags"}
          </span>
          {"\n"}
          <span className={cm}>{"// scope: identity.name identity.dob"}</span>
          {"\n"}
          <span className={cm}>
            {"//   \u2192 step-up: returns PII via id_token only"}
          </span>
          {"\n\n"}
          <span className={cm}>
            {"// Step 3: Userinfo returns proofs, not PII"}
          </span>
          {"\n"}
          {"{\n"}
          {"  "}
          <span className={str}>{'"sub"'}</span>:{" "}
          <span className={str}>{'"usr_abc123"'}</span>,{"\n"}
          {"  "}
          <span className={str}>{'"email"'}</span>:{" "}
          <span className={str}>{'"user@example.com"'}</span>,{"\n"}
          {"  "}
          <span className={str}>{'"verified"'}</span>:{" "}
          <span className={num}>true</span>,{"\n"}
          {"  "}
          <span className={str}>{'"verification_level"'}</span>:{" "}
          <span className={str}>{'"full"'}</span>,{"\n"}
          {"  "}
          <span className={str}>{'"identity_bound"'}</span>:{" "}
          <span className={num}>true</span>
          {"\n}"}
        </pre>
      </div>
    </div>
  );
}

export function ZkAuthPage() {
  return (
    <PageLayout
      title="ZK-Auth: Zero-Knowledge Identity Provider"
      description="Zero-knowledge cryptography changes what SSO delivers: instead of raw PII, relying parties receive cryptographic proofs. Verified answers without the underlying data, integrated via standard OAuth 2.1."
    >
      <div className="space-y-12">
        {/* The Paradigm Shift Section */}
        <section>
          <div className="mb-6">
            <h2 className="font-display text-2xl font-semibold">
              What changes when proofs replace PII
            </h2>
            <p className="landing-body mt-2">
              Standard SSO exchanges data for convenience. ZK-Auth exchanges
              proofs for the same convenience, without the liability.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Traditional SSO */}
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <IconDatabaseOff
                    className={cn("size-5", colorStyles.red.iconText)}
                  />
                  <h3>Collection-based SSO</h3>
                </div>
                <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
                  The data-for-convenience trade
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
                      <strong>Data liability:</strong> The relying party
                      receives raw PII (emails, names, dates of birth) and
                      inherits the obligation to secure, retain, and eventually
                      delete it.
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
                      <strong>Correlation risk:</strong> The identity provider
                      sees every service the user visits. The same identifier
                      appears across all relying parties, enabling cross-service
                      tracking.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Zentity SSO */}
            <Card>
              <CardContent className="pt-6">
                <div className="mb-4 flex items-center gap-2 font-semibold">
                  <IconShieldCheck
                    className={cn("size-5", iconSemanticColors.shield)}
                  />
                  <h3>Zentity ZK-Auth</h3>
                </div>
                <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
                  Proof-based verification
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
                      <strong>No data liability:</strong> The relying party
                      requests proof scopes (e.g.,{" "}
                      <code className="text-xs">proof:age</code>) and receives
                      verified boolean flags. No passport stored, no PII
                      retained.
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
                      <strong>No correlation:</strong> Pairwise pseudonyms per
                      relying party. The identity provider cannot track which
                      services the user visits. Cross-service linking is
                      mathematically prevented.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* What makes this different */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            What the protocol changes
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            Standard OAuth 2.1 and OIDC, but the default payload is
            fundamentally different:{" "}
            <strong>
              relying parties receive cryptographic proofs, not personal data.
            </strong>
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <IconShieldCheck
                    className={cn("size-5", iconSemanticColors.shield)}
                  />
                  <h3 className="font-semibold">Proofs first, data second</h3>
                </div>
                <p className="landing-body">
                  Collection-based identity flows deliver raw PII the moment a
                  user logs in. Proof-based scopes (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    proof:age
                  </code>
                  ,{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    proof:verification
                  </code>
                  ) answer the question without revealing the underlying data. A
                  service learns "this person is over 21"{" "}
                  <strong>without ever seeing a date of birth.</strong>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <IconLock className={cn("size-5", iconSemanticColors.lock)} />
                  <h3 className="font-semibold">Encrypted computation</h3>
                </div>
                <p className="landing-body">
                  Compliance checks often require processing personal data (age
                  thresholds, jurisdiction membership, and risk scoring). With
                  fully homomorphic encryption (FHE), the server evaluates these
                  policies directly on ciphertexts, returning an encrypted yes
                  or no{" "}
                  <strong>
                    without ever decrypting the underlying attributes.
                  </strong>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <IconKey className={cn("size-5", iconSemanticColors.key)} />
                  <h3 className="font-semibold">User-controlled vault</h3>
                </div>
                <p className="landing-body">
                  When a service legally needs actual personal data (e.g., a
                  bank opening an account), the user unlocks their credential
                  vault with their passkey, password, or wallet and approves
                  exactly which fields to share.{" "}
                  <strong>
                    Zentity cannot release PII without the user actively
                    participating
                  </strong>{" "}
                  in the consent and unlock flow.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <IconShieldLock
                    className={cn("size-5", iconSemanticColors.lock)}
                  />
                  <h3 className="font-semibold">Post-quantum delivery</h3>
                </div>
                <p className="landing-body">
                  When PII is shared, it is encrypted with ML-KEM-768 (NIST FIPS
                  203), a post-quantum key encapsulation standard. This protects
                  against "harvest now, decrypt later" attacks where adversaries
                  capture encrypted traffic today and break it with a future
                  quantum computer. Compliance records often have multi-year
                  retention requirements, so{" "}
                  <strong>
                    the encryption must outlast the retention period.
                  </strong>
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Protocol-Level Integration */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Integration at the protocol level, not the library level
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            The integration boundary is OAuth 2.1 and OpenID Connect, the same
            protocols your application already speaks. No SDK to install, no
            custom protocol to learn, no cryptography infrastructure to host.{" "}
            <strong>
              If you can add "Sign in with Google," you can add Zentity.
            </strong>{" "}
            This applies whether verification runs through Zentity directly or
            through your existing identity provider: the relying party receives
            the same privacy-preserving proofs via the same OIDC scopes.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <IconPlugConnected
                  className={cn("size-5", iconSemanticColors.oauth)}
                />
                <h3 className="mt-3 font-semibold">No SDK to install</h3>
                <p className="landing-body mt-1">
                  Any language, any framework, any OAuth library. Django, Rails,
                  Spring, Express, Laravel, or a raw HTTP client.{" "}
                  <strong>The protocol is the interface.</strong>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconCode
                  className={cn("size-5", iconSemanticColors.developer)}
                />
                <h3 className="mt-3 font-semibold">No cryptography code</h3>
                <p className="landing-body mt-1">
                  Zero-knowledge proofs, FHE, and cryptographic commitments
                  happen behind the protocol boundary.{" "}
                  <strong>
                    The relying party never touches a proof, a circuit, or a
                    ciphertext.
                  </strong>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <IconUserCheck
                  className={cn("size-5", iconSemanticColors.oauth)}
                />
                <h3 className="mt-3 font-semibold">No new infrastructure</h3>
                <p className="landing-body mt-1">
                  No blockchain nodes, no relay servers, and no WebSocket
                  connections. The relying party calls standard HTTPS endpoints
                  and reads standard JWTs.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <ul className="space-y-6">
                  <li className="flex items-start gap-3">
                    <IconUserCheck
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        iconSemanticColors.oauth,
                      )}
                    />
                    <div>
                      <h3 className="font-semibold">Standard OIDC flow</h3>
                      <p className="landing-body mt-1">
                        Redirect to the authorization endpoint, receive an auth
                        code, exchange it for a JWT. Dynamic Client Registration
                        (RFC 7591) means the entire setup can be automated with
                        a single POST request.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <IconLock
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        iconSemanticColors.lock,
                      )}
                    />
                    <div>
                      <h3 className="font-semibold">Scope-based proofs</h3>
                      <p className="landing-body mt-1">
                        Scopes like{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                          proof:age
                        </code>{" "}
                        or{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                          proof:verification
                        </code>{" "}
                        return boolean verification flags. PII scopes like{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                          identity.name
                        </code>{" "}
                        are requested only when regulation requires the actual
                        data.
                      </p>
                    </div>
                  </li>
                </ul>
                <Link
                  to="/docs/oauth-integrations"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "mt-6 h-9 rounded-sm px-4",
                  )}
                >
                  Open OAuth integration docs
                  <IconArrowRight className="ml-2 size-4" />
                </Link>
              </CardContent>
            </Card>

            <CodeWindow filename="example-integration.ts" />
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

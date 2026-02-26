import {
  IconArrowRight,
  IconCheck,
  IconDatabaseOff,
  IconLock,
  IconShieldCheck,
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
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-24 md:py-28"
      >
        <header className="mb-8 max-w-3xl">
          <h1 className="font-display font-semibold text-4xl leading-tight">
            {title}
          </h1>
          <p className="landing-copy mt-3">{description}</p>
        </header>
        {children}
      </main>
      <Footer />
    </div>
  );
}

export function ZkAuthPage() {
  return (
    <PageLayout
      title="ZK-Auth: Zero-Knowledge Identity Provider"
      description="Transform your user onboarding with Zero-Liability SSO. Embed our “Login with Zentity” button to onboard verified users instantly, without absorbing the liability of storing their private data."
    >
      <div className="space-y-12">
        {/* The Paradigm Shift Section */}
        <section>
          <div className="mb-6">
            <h2 className="font-display text-2xl font-semibold">
              The Zero-Liability SSO Paradigm
            </h2>
            <p className="landing-body mt-2">
              Why developers are switching from Data-for-Convenience to
              Zero-Knowledge Auth.
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
                  <h3>Traditional SSO</h3>
                </div>
                <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
                  The "Data-for-Convenience" Trade
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
                      <strong>Massive Liability:</strong> You receive raw PII
                      (emails, names, dates of birth). You must secure it,
                      comply with GDPR/CCPA, and risk devastating breaches.
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
                      <strong>IdP Surveillance:</strong> The Identity Provider
                      tracks every service your users log into, building massive
                      advertising profiles.
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
                  The "Zero-Liability" Paradigm
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
                      <strong>Zero Liability:</strong> You request "proofs"
                      (e.g., <code className="text-xs">proof:age</code>), and
                      receive a verified boolean flag. You don't store the
                      passport; you store the cryptographic proof.
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
                      <strong>Blind IdP:</strong> Zentity is cryptographically
                      blind to where the user is logging in. The network
                      verifies the truth without tracking the user.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Developer Experience */}
        <section>
          <h2 className="font-display text-2xl font-semibold">
            Familiar developer experience
          </h2>
          <p className="landing-body mt-2 max-w-2xl">
            You don't need a PhD in cryptography to use Zentity. We expose our
            Zero-Knowledge network through standard OAuth 2.1 and OIDC
            protocols.
          </p>

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
                      <h3 className="font-semibold">Standard OIDC Flow</h3>
                      <p className="landing-body mt-1">
                        Redirect users to our authorization endpoint, receive an
                        auth code, and exchange it for a standard JWT.
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
                      <h3 className="font-semibold">Scope-Based Proofs</h3>
                      <p className="landing-body mt-1">
                        Request boolean verification flags with{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">
                          proof:verification
                        </code>{" "}
                        or{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">
                          proof:age
                        </code>
                        . Step up to PII with{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">
                          identity.name
                        </code>{" "}
                        only when policy requires it.
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
                  Open OAuth Integration Docs
                  <IconArrowRight className="ml-2 size-4" />
                </Link>
              </CardContent>
            </Card>

            <Card className="overflow-hidden bg-zinc-950 text-zinc-50 dark:bg-zinc-900 border-none">
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-mono text-zinc-400">
                <span>implementation.ts</span>
              </div>
              <div className="p-4 overflow-x-auto text-sm font-mono">
                <pre>
                  {`// 1. Register via Dynamic Client Registration
const reg = await fetch(
  "https://app.zentity.xyz/api/auth/oauth2/register",
  { method: "POST", body: JSON.stringify({
    client_name: "My App",
    redirect_uris: ["https://myapp.com/callback"],
    scope: "openid email proof:verification",
    grant_types: ["authorization_code"],
    token_endpoint_auth_method: "none",
  })}
);
const { client_id } = await reg.json();

// 2. Redirect with PKCE
// scope: openid email proof:verification
//   → returns boolean verification flags
// scope: identity.name identity.dob
//   → step-up: returns PII via id_token only

// 3. Userinfo returns proofs, not PII
{
  "sub": "usr_abc123",
  "email": "user@example.com",
  "verified": true,
  "verification_level": "full",
  "identity_binding_verified": true
}`}
                </pre>
              </div>
            </Card>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}

import { IconArrowRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        className="-translate-y-full fixed top-2 left-2 z-[60] rounded-md bg-background px-3 py-2 text-sm shadow transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to content
      </a>
      <Nav />
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-24 md:py-28"
      >
        <header className="mb-8 max-w-3xl">
          <h1 className="font-display text-4xl leading-tight">{title}</h1>
          <p className="landing-copy mt-3">{description}</p>
        </header>
        {children}
      </main>
      <Footer />
    </div>
  );
}

const frameworks = [
  {
    name: "GDPR",
    scope: "EU data protection",
    mapping:
      "Data minimization, purpose limitation, and selective disclosure support.",
  },
  {
    name: "AMLD5/AMLD6 + AMLR",
    scope: "EU AML and KYC",
    mapping:
      "Verification evidence trails and retention-aware policy workflows.",
  },
  {
    name: "MiCA",
    scope: "EU crypto regulation",
    mapping:
      "Exchange-oriented identity verification and compliance proof surfaces.",
  },
  {
    name: "eIDAS 2.0 + EUDI wallet direction",
    scope: "EU digital identity interoperability",
    mapping: "OIDC4VCI/VP and SD-JWT compatibility pathways.",
  },
  {
    name: "FinCEN CIP + BSA",
    scope: "US banking and AML",
    mapping:
      "Identity scopes for regulated disclosure when customer identification is required.",
  },
  {
    name: "FATF Travel Rule",
    scope: "Global crypto and VASP disclosures",
    mapping:
      "Policy-constrained claim sharing and auditable disclosure context.",
  },
];

const standards = [
  {
    name: "OAuth 2.1 + OpenID Connect",
    value: "Auth + identity under one standards-based integration surface.",
  },
  {
    name: "RFC 7591 Dynamic Client Registration",
    value:
      "Programmatic relying-party onboarding without manual client setup loops.",
  },
  {
    name: "Scope-filtered claim delivery",
    value:
      "Relying parties request only the claims they need via `proof:*` and `identity.*` scopes.",
  },
  {
    name: "SD-JWT VC + OIDC4VCI/VP",
    value: "Wallet-compatible credential issuance and presentation pathways.",
  },
  {
    name: "Post-quantum migration path",
    value:
      "Design includes migration-ready encryption/signing posture for long-retention environments.",
  },
];

export function CompliancePage() {
  return (
    <PageLayout
      title="Compliance Mapping"
      description="How Zentity's architecture maps to common identity and regulated disclosure requirements."
    >
      <Card>
        <CardContent className="pt-6">
          <p className="landing-caption mb-4 uppercase tracking-[0.16em]">
            Framework coverage
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Framework</TableHead>
                <TableHead>Regulatory scope</TableHead>
                <TableHead>Architecture mapping</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {frameworks.map((item) => (
                <TableRow key={item.name}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.scope}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.mapping}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="landing-caption mt-4">
            This page describes technical alignment patterns, not legal advice
            or legal certification.
          </p>
        </CardContent>
      </Card>
    </PageLayout>
  );
}

export function InteroperabilityPage() {
  return (
    <PageLayout
      title="Interoperability Standards"
      description="Zentity prioritizes standards to reduce migration cost and integration friction."
    >
      <Card>
        <CardContent className="pt-6">
          <ul className="space-y-3">
            {standards.map((item) => (
              <li
                key={item.name}
                className="rounded-md border border-border bg-background p-4"
              >
                <p className="font-semibold">{item.name}</p>
                <p className="landing-body mt-1">{item.value}</p>
              </li>
            ))}
          </ul>
          <Link
            to="/docs/oauth-integrations"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "mt-5 h-9 rounded-sm px-4",
            )}
          >
            Open OAuth/OIDC integration docs
            <IconArrowRight className="ml-2 size-4" />
          </Link>
        </CardContent>
      </Card>
    </PageLayout>
  );
}

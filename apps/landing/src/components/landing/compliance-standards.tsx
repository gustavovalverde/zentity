import {
  IconCheck,
  IconFileCode,
  IconScale,
  IconWorld,
} from "@tabler/icons-react";

import { Link } from "react-router-dom";

import { SectionHeader } from "@/components/landing/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { colorStyles } from "@/lib/colors";
import { iconSemanticColors } from "@/lib/icon-semantics";
import { cn } from "@/lib/utils";

const frameworks = [
  {
    framework: "GDPR",
    scope: "EU data protection",
    mapping: "Data minimization and selective disclosure support",
  },
  {
    framework: "AMLD5/AMLD6 + AMLR",
    scope: "EU AML and customer due diligence",
    mapping: "Verification evidence trails and retention-aware workflows",
  },
  {
    framework: "MiCA",
    scope: "EU crypto regulation",
    mapping: "Exchange-oriented identity checks and compliance proofs",
  },
  {
    framework: "eIDAS 2.0 + EUDI wallet direction",
    scope: "EU digital identity interoperability",
    mapping:
      "OIDC4VCI, OIDC4VP, and OIDC4IDA compatibility pathways; HAIP wallet attestation alignment",
  },
  {
    framework: "FinCEN CIP + BSA",
    scope: "US banking and AML",
    mapping: "Identity scopes for regulated disclosure when required",
  },
  {
    framework: "FATF Travel Rule",
    scope: "Cross-border crypto transfers",
    mapping: "Policy-driven claim release and auditable payload boundaries",
  },
];

const standardGroups: Array<{ label: string; items: string[] }> = [
  {
    label: "Identity & interoperability",
    items: [
      "OAuth 2.1 authorization code flow",
      "OpenID Connect (OIDC)",
      "RFC 7591 Dynamic Client Registration",
      "SD-JWT Verifiable Credentials",
      "OIDC4VCI / OIDC4VP / OIDC4IDA profile",
      "HAIP (High Assurance Interoperability Profile)",
    ],
  },
  {
    label: "Transport security",
    items: [
      "RFC 9126 Pushed Authorization Requests (PAR)",
      "RFC 9449 DPoP (Demonstration of Proof-of-Possession)",
      "JARM (JWT Secured Authorization Response Mode)",
    ],
  },
  {
    label: "Agentic authorization",
    items: [
      "Agent Auth Protocol v1.0-draft (agent identity and lifecycle)",
      "OpenID Connect CIBA Core (backchannel consent)",
      "RFC 9396 Rich Authorization Requests (RAR)",
      "RFC 8693 Token Exchange (delegation chains)",
      "draft-ietf-oauth-first-party-apps (headless bootstrap)",
    ],
  },
  {
    label: "Cryptography",
    items: ["Post-quantum migration alignment (FIPS 203/204)"],
  },
];

const deepDiveLinks = [
  {
    title: "System architecture",
    body: "Trust boundaries across web, OCR, FHE, and evidence services.",
    href: "/docs/architecture",
  },
  {
    title: "Attestation privacy model",
    body: "What stays encrypted, what is transient, and what is disclosed by scope.",
    href: "/docs/attestation-privacy",
  },
  {
    title: "OAuth/OIDC integration",
    body: "Scope contracts for banks, exchanges, and other relying parties.",
    href: "/docs/oauth-integrations",
  },
  {
    title: "Cryptographic pillars",
    body: "Passkeys, commitments, ZK proofs, FHE, and post-quantum migration.",
    href: "/docs/cryptographic-pillars",
  },
  {
    title: "Agent architecture",
    body: "How agent identity, human consent, and pairwise delegation compose into a single binding chain.",
    href: "/docs/agent-architecture",
  },
];

export function ComplianceStandards() {
  return (
    <section className="landing-section landing-band-muted" id="compliance">
      <div className="landing-container">
        <SectionHeader
          title="Regulatory alignment"
          subtitle="Zentity is a cryptographic verification layer, not a compliance service. These mappings describe how the architecture's privacy properties align with regulatory frameworks. They are not certifications or legal guarantees."
          maxWidth="lg"
        />

        <div className="landing-grid-2">
          <Card className="overflow-hidden">
            <CardHeader className="pb-0">
              <div className="mb-1 flex items-center gap-2">
                <IconScale
                  className={cn("size-4", iconSemanticColors.compliance)}
                />
                <CardTitle className="landing-card-title">
                  Compliance frameworks
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
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
                      <TableRow key={item.framework}>
                        <TableCell className="font-medium">
                          {item.framework}
                        </TableCell>
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
              </div>
              <p className="landing-caption mt-4">
                This is architecture mapping guidance, not legal certification
                or legal advice.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-0">
              <div className="mb-1 flex items-center gap-2">
                <IconWorld
                  className={cn("size-4", iconSemanticColors.portability)}
                />
                <CardTitle className="landing-card-title">
                  Standards implemented
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4">
                {standardGroups.map((group) => (
                  <div key={group.label}>
                    <p className="landing-caption mb-2 font-medium text-foreground">
                      {group.label}
                    </p>
                    <ul className="space-y-1.5">
                      {group.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-sm"
                        >
                          <IconCheck
                            className={cn(
                              "mt-0.5 size-4 shrink-0",
                              colorStyles.emerald.iconText,
                            )}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="landing-caption mt-4">
                No custom protocol is required. Teams can integrate through
                OAuth/OIDC scopes and user-approved claim sharing.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5">
          <CardHeader className="pb-0">
            <div className="mb-1 flex items-center gap-2">
              <IconFileCode
                className={cn("size-4", iconSemanticColors.developer)}
              />
              <CardTitle className="landing-card-title">
                Technical documentation paths
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="landing-body">
              Technical and privacy documentation for engineering, security, and
              compliance reviews.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {deepDiveLinks.map((item) => (
                <Link
                  key={item.title}
                  to={item.href}
                  className="rounded-md border border-border bg-background p-3 transition-colors hover:bg-muted/40"
                >
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="landing-caption mt-1">{item.body}</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

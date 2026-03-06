import {
  IconBrandOpenSource,
  IconCheck,
  IconEyeOff,
  IconFingerprint,
  IconHeart,
  IconKey,
  IconLayersLinked,
  IconLock,
  IconPlugConnected,
  IconShieldCheck,
  IconStairsUp,
  IconTrash,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { CTASection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { SectionHeader } from "@/components/landing/section-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { colorStyles, type SemanticColor } from "@/lib/colors";
import { useDocumentHead } from "@/lib/use-document-head";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Section 2: Architectural Properties
// ---------------------------------------------------------------------------

const architecturalProperties: Array<{
  icon: typeof IconShieldCheck;
  color: SemanticColor;
  title: string;
  enables: string;
  description: string;
}> = [
  {
    icon: IconShieldCheck,
    color: "purple",
    title: "Verification Without Collection",
    enables: "Age gates, sanctions screening, liveness attestation",
    description:
      "Zero-knowledge proofs, generated client-side, verify facts about identity data without transmitting the data itself. The verifier learns the answer. The prover keeps the inputs. A compromised server cannot extract what it never received.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Computation Without Decryption",
    enables: "Perpetual screening, encrypted re-evaluation, ongoing compliance",
    description:
      "Fully homomorphic encryption lets the server re-screen encrypted nationality and date-of-birth values against updated sanctions lists without decrypting. Unlike ZK proofs, FHE handles list updates without any user action.",
  },
  {
    icon: IconEyeOff,
    color: "amber",
    title: "Authentication Without Identification",
    enables: "Cross-platform SSO, unlinkable logins, anti-surveillance",
    description:
      "Pairwise identifiers give each service a unique pseudonym for the same user. Service A and Service B cannot determine they deal with the same person, even if they compare records. Cross-service correlation is mathematically impossible.",
  },
  {
    icon: IconKey,
    color: "emerald",
    title: "Custody Without Exposure",
    enables: "Breach immunity, credential-wrapped storage, user sovereignty",
    description:
      "All sensitive data is encrypted with keys derived from the user's own credential: passkey, password, or wallet signature. The server stores encrypted blobs it cannot decrypt. A breach yields ciphertexts that are useless without the user's credential.",
  },
];

// ---------------------------------------------------------------------------
// Section 3: Scenarios (flat list, ordered by importance)
// ---------------------------------------------------------------------------

interface ScenarioItem {
  icon: typeof IconShieldCheck;
  color: SemanticColor;
  category: string;
  title: string;
  description: ReactNode;
  signal: string;
  regulations: string[];
  industries: string[];
}

const scenarios: ScenarioItem[] = [
  {
    icon: IconShieldCheck,
    color: "purple",
    category: "Threshold Proofs",
    title: "Age Verification",
    description: (
      <>
        A retailer, platform, or regulator needs to know "old enough." A
        threshold proof answers the question without creating the liability. The
        verifier learns <strong>the answer and nothing else</strong>.
      </>
    ),
    signal: "Three jurisdictions enforcing simultaneously in 2026",
    regulations: ["UK OSA", "EU DSA", "US State Laws"],
    industries: ["Regulated Content", "Commerce"],
  },
  {
    icon: IconFingerprint,
    color: "amber",
    category: "Human Proof",
    title: "Agent Delegation",
    description: (
      <>
        AI agents act with scoped credentials. High-stakes actions require a{" "}
        <strong>passkey gesture proving human approval</strong>.
      </>
    ),
    signal: "88% of orgs report AI agent security incidents",
    regulations: ["EU AI Act"],
    industries: ["AI Assistants", "Finance", "Autonomous Agents"],
  },
  {
    icon: IconFingerprint,
    color: "amber",
    category: "Human Proof",
    title: "Bot-Proof Platforms",
    description: (
      <>
        Sybil-resistant nullifiers confirm a <strong>unique, live human</strong>{" "}
        acted without learning which human. Pairwise pseudonyms prevent
        cross-platform tracking.
      </>
    ),
    signal: "AI-driven fraud up 180%, deepfakes pass live interviews",
    regulations: [],
    industries: ["Social Networks", "Review Sites", "Gaming"],
  },
  {
    icon: IconPlugConnected,
    color: "purple",
    category: "Trust Tiers",
    title: "Zero-Knowledge SSO",
    description: (
      <>
        Standard OIDC redirect with pairwise pseudonyms and{" "}
        <strong>ZK proofs instead of PII in tokens</strong>. Each service sees a
        unique identifier; the identity provider cannot track which services the
        user visits.
      </>
    ),
    signal: "Passkey adoption up 412%, zero phishing on passwordless",
    regulations: ["eIDAS 2.0", "NIST 800-63-4"],
    industries: ["SaaS", "Consumer Apps"],
  },
  {
    icon: IconWallet,
    color: "amber",
    category: "Portable Trust",
    title: "Verifiable Credentials",
    description: (
      <>
        After verification, users receive{" "}
        <strong>portable credentials they own</strong>. Selective disclosure
        lets them reveal only the claims each service needs, and holder binding
        prevents transfer or theft.
      </>
    ),
    signal: "OID4VCI self-certification launched Feb 2026, 38 jurisdictions",
    regulations: ["eIDAS 2.0", "EUDI Wallet"],
    industries: ["Multi-Platform", "Gig Economy"],
  },
  {
    icon: IconStairsUp,
    color: "orange",
    category: "Trust Tiers",
    title: "Step-Up Authentication",
    description: (
      <>
        Viewing a balance needs basic login;{" "}
        <strong>wiring funds needs document-verified identity</strong>. One
        OAuth scope model.
      </>
    ),
    signal: "Industry shift from binary auth to continuous trust",
    regulations: ["NIST 800-63-4"],
    industries: ["Banking", "Insurance", "Enterprise"],
  },
  {
    icon: IconLock,
    color: "blue",
    category: "Compliance",
    title: "Encrypted AML Screening",
    description: (
      <>
        FHE screens encrypted nationality and DOB against sanctions lists. A
        breach yields <strong>only ciphertexts</strong>.
      </>
    ),
    signal: "AMLA enforcing directly, Travel Rule fines hitting €12M",
    regulations: ["AMLA", "FATF Travel Rule"],
    industries: ["Banks", "Payment Processors", "Exchanges"],
  },
  {
    icon: IconBrandOpenSource,
    color: "purple",
    category: "Verify Once",
    title: "Protocol Distribution",
    description: (
      <>
        A <strong>single verification</strong> distributes to every connected
        service through standard OAuth. Any application that supports OIDC can
        consume attestations without custom integration or cryptography code.
      </>
    ),
    signal: "Reusable identity is the dominant market narrative",
    regulations: [],
    industries: ["Multi-Exchange", "Neobanks"],
  },
  {
    icon: IconLock,
    color: "blue",
    category: "Compliance",
    title: "On-Chain Compliance",
    description: (
      <>
        fhEVM evaluates rules against encrypted identity attributes on-chain.{" "}
        <strong>Failed checks stay private</strong>.
      </>
    ),
    signal: "MiCA transitions expiring, DeFi facing 'same risk, same rule'",
    regulations: ["MiCA", "GENIUS Act"],
    industries: ["DeFi Protocols", "Token Transfers"],
  },
  {
    icon: IconWallet,
    color: "amber",
    category: "Portable Trust",
    title: "Cross-Platform Reputation",
    description: (
      <>
        A freelancer demonstrates verified identity and strong track record
        across platforms{" "}
        <strong>without those platforms being able to correlate</strong> the
        presentations.
      </>
    ),
    signal: "1.5B decentralized identities projected for 2026",
    regulations: ["eIDAS 2.0"],
    industries: ["Freelance", "Creator Economy"],
  },
  {
    icon: IconBrandOpenSource,
    color: "purple",
    category: "Verify Once",
    title: "Incremental Verification",
    description: (
      <>
        Each document is a discrete attestation that coexists with prior ones. A
        new passport <strong>supplements rather than replaces</strong>, and
        services see only what they explicitly request.
      </>
    ),
    signal: "Progressive verification now expected as table stakes",
    regulations: [],
    industries: ["Multi-Nationality", "Regulatory"],
  },
  {
    icon: IconShieldCheck,
    color: "purple",
    category: "Threshold Proofs",
    title: "Jurisdiction Membership",
    description: (
      <>
        An exchange needs "eligible jurisdiction." Merkle proofs verify group
        inclusion (EU, Schengen, EEA){" "}
        <strong>without revealing the specific country</strong>. The exchange
        learns the answer, not which member.
      </>
    ),
    signal: "MiCA country-by-country transitions create immediate need",
    regulations: ["MiCA", "FATF Travel Rule"],
    industries: ["Crypto Exchanges", "Cross-Border Finance"],
  },
  {
    icon: IconHeart,
    color: "pink",
    category: "At the Margins",
    title: "Identity Without Documents",
    description: (
      <>
        Biometric verification and NGO-signed attestations establish{" "}
        <strong>identity without government documents</strong>. FROST threshold
        key recovery ensures the person retains control even after losing a
        device.
      </>
    ),
    signal: "1 billion people globally lack government-recognized ID",
    regulations: ["SDG 16.9"],
    industries: ["Refugee Services", "Humanitarian Aid"],
  },
  {
    icon: IconHeart,
    color: "pink",
    category: "At the Margins",
    title: "Anonymous Civic Participation",
    description: (
      <>
        ZK proofs of eligibility with sybil-resistant nullifiers guarantee{" "}
        <strong>one vote per person, unlinkable to identity</strong>.
      </>
    ),
    signal: "Pilots in 5+ countries, 72% satisfaction in Israel trial",
    regulations: [],
    industries: ["Governance", "DAO Voting"],
  },
];

// ---------------------------------------------------------------------------
// Section 4: Comparison Table
// ---------------------------------------------------------------------------

const comparisonRows: Array<{
  capability: string;
  traditional: string;
  zentity: string;
}> = [
  {
    capability: "Prove a fact without revealing data",
    traditional: "Requires sharing PII to prove anything",
    zentity: "ZK proofs verify without disclosure",
  },
  {
    capability: "Re-screen without storing data",
    traditional: "Must retain PII for ongoing compliance",
    zentity: "FHE computes on encrypted data",
  },
  {
    capability: "Verify once, use across services",
    traditional: "Re-verify per provider, results siloed",
    zentity: "Single verification distributed via OAuth",
  },
  {
    capability: "Prevent cross-service tracking",
    traditional: "Same email or ID used everywhere",
    zentity: "Pairwise identifiers per service",
  },
  {
    capability: "Prove human presence",
    traditional: "CAPTCHAs, increasingly defeated by AI",
    zentity: "Passkey signatures require physical hardware",
  },
  {
    capability: "Share selectively",
    traditional: "All-or-nothing data release",
    zentity: "Granular control over each claim",
  },
  {
    capability: "Erase completely",
    traditional: "Data scattered across many services",
    zentity: "Deleting the credential orphans all data",
  },
  {
    capability: "Resist quantum attacks",
    traditional: "Classical cryptography only",
    zentity: "ML-KEM-768, ML-DSA-65 (NIST FIPS 203/204)",
  },
];

// ---------------------------------------------------------------------------
// Section 4: Resilience Cards
// ---------------------------------------------------------------------------

const resilienceCards: Array<{
  icon: typeof IconShieldCheck;
  color: SemanticColor;
  title: string;
  description: string;
}> = [
  {
    icon: IconShieldCheck,
    color: "emerald",
    title: "Breach Yields Nothing",
    description:
      "Credential-wrapped key custody and FHE ciphertexts mean a server breach exposes no usable data. The server never possesses the decryption keys.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Post-Quantum Durability",
    description:
      "Recovery keys use ML-KEM-768. Credential signing uses ML-DSA-65. Identity data has a longer useful lifetime than most encrypted data, making harvest-now-decrypt-later attacks the primary threat.",
  },
  {
    icon: IconTrash,
    color: "red",
    title: "Erasure by Deletion",
    description:
      "Deleting the user's credential orphans all encrypted data. No administrator backdoor — recovery uses FROST threshold guardian signatures (no single key). GDPR right to erasure as an architectural property.",
  },
];

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export function CapabilitiesPage() {
  useDocumentHead({
    title: "Capabilities | Zentity",
    description:
      "Scenarios where verification must not require revelation: threshold proofs, graduated trust, portable verification, and the cryptographic primitives that address them.",
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

      <main id="main-content">
        {/* Section 1: Header */}
        <section className="landing-band-flat px-4 pt-24 pb-8 md:px-6 md:pt-28">
          <div className="landing-container">
            <header className="max-w-3xl">
              <h1 className="font-display font-semibold text-4xl leading-tight">
                Where Verification Must Not Require Revelation
              </h1>
              <p className="landing-copy mt-3">
                These scenarios share a structural requirement: proving facts
                about identity without disclosing the data behind them. The
                cryptographic primitives are the same across all of them; what
                varies is the fact being proved and the consequences of a
                privacy failure.
              </p>
            </header>
          </div>
        </section>

        {/* Section 2: Architectural Properties */}
        <section
          className="landing-section landing-band-flat"
          id="architectural-properties"
        >
          <div className="landing-container">
            <SectionHeader
              title="Architectural properties"
              subtitle="Four decouplings that traditional identity systems cannot achieve. Each one breaks a different link between knowing data and using it."
            />

            <div className="grid gap-6 md:grid-cols-2">
              {architecturalProperties.map((prop) => (
                <Card key={prop.title} className="flex h-full flex-col">
                  <CardHeader className="pb-0">
                    <div className="flex items-center gap-3">
                      <prop.icon
                        className={cn(
                          "size-5 shrink-0",
                          colorStyles[prop.color].iconText,
                        )}
                      />
                      <CardTitle className="landing-card-title">
                        {prop.title}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="flex grow flex-col pt-3">
                    <p className="landing-body grow">{prop.description}</p>
                    <p className="mt-4 landing-caption">
                      <span className="font-medium text-foreground">
                        Enables:
                      </span>{" "}
                      {prop.enables}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Section 2b: Two Integration Paths */}
        <section
          className="landing-section landing-band-muted"
          id="integration-paths"
        >
          <div className="landing-container">
            <SectionHeader
              title="Two integration paths, one set of primitives"
              subtitle="The same cryptographic architecture serves applications with no existing verification and applications with established providers. The primitives are identical; the verification source differs."
            />

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="flex h-full flex-col">
                <CardContent className="flex grow flex-col pt-6">
                  <IconLayersLinked
                    className={cn("size-5", colorStyles.purple.iconText)}
                  />
                  <h3 className="mt-3 font-semibold">
                    Full-stack verification
                  </h3>
                  <p className="landing-body mt-2 grow">
                    For applications without existing identity verification.
                    Zentity handles document OCR, liveness detection, face
                    matching, proof generation, and credential delivery. The
                    relying party integrates via OAuth 2.1.
                  </p>
                </CardContent>
              </Card>

              <Card className="flex h-full flex-col">
                <CardContent className="flex grow flex-col pt-6">
                  <IconPlugConnected
                    className={cn("size-5", colorStyles.amber.iconText)}
                  />
                  <h3 className="mt-3 font-semibold">Proof layer</h3>
                  <p className="landing-body mt-2 grow">
                    The same cryptographic primitives work over
                    externally-verified identity. When a trusted provider
                    verifies identity, Zentity generates zero-knowledge proofs
                    over those signed claims and delivers them via OIDC. The
                    relying party receives proofs instead of raw identity data.
                    The verification provider never learns which service
                    requested the proof.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Section 3: Where This Applies */}
        <section
          className="landing-section landing-band-flat"
          id="where-this-applies"
        >
          <div className="landing-container">
            <SectionHeader
              title="Where this applies"
              subtitle="Each scenario requires a different combination of the same primitives. Ordered by adoption signal strength."
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scenarios.map((scenario) => (
                <Card key={scenario.title} className="flex flex-col">
                  <CardContent className="flex grow flex-col pt-5">
                    <div className="mb-3 flex items-center gap-2">
                      <scenario.icon
                        className={cn(
                          "size-4 shrink-0",
                          colorStyles[scenario.color].iconText,
                        )}
                      />
                      <span className="landing-caption font-medium">
                        {scenario.category}
                      </span>
                    </div>
                    <h3 className="font-semibold leading-snug">
                      {scenario.title}
                    </h3>
                    <p className="mt-1.5 landing-caption">
                      {scenario.description}
                    </p>
                    <p className="mt-2 grow text-xs italic text-muted-foreground/70">
                      {scenario.signal}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {[...scenario.regulations, ...scenario.industries].map(
                        (tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs"
                          >
                            {tag}
                          </Badge>
                        ),
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Section 4: Lifecycle and Resilience */}
        <section
          className="landing-section landing-band-flat"
          id="lifecycle-and-resilience"
        >
          <div className="landing-container">
            <SectionHeader
              title="Lifecycle and resilience"
              subtitle="How the architecture holds up over time and under attack."
            />

            {/* Comparison Table */}
            <Card className="mb-10">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Capability</TableHead>
                      <TableHead>Traditional Identity</TableHead>
                      <TableHead className="pr-4">Zentity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparisonRows.map((row) => (
                      <TableRow key={row.capability}>
                        <TableCell className="pl-4 font-medium text-foreground whitespace-normal">
                          {row.capability}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="inline-flex items-center gap-1.5">
                            <IconX
                              className={cn(
                                "size-3.5 shrink-0",
                                colorStyles.red.iconText,
                              )}
                            />
                            <span className="landing-caption">
                              {row.traditional}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="pr-4 whitespace-normal">
                          <span className="inline-flex items-center gap-1.5">
                            <IconCheck
                              className={cn(
                                "size-3.5 shrink-0",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <span className="landing-caption">
                              {row.zentity}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Resilience Cards */}
            <div className="grid gap-6 sm:grid-cols-3">
              {resilienceCards.map((card) => (
                <Card key={card.title}>
                  <CardContent className="pt-6">
                    <card.icon
                      className={cn("size-5", colorStyles[card.color].iconText)}
                    />
                    <h3 className="mt-3 font-semibold">{card.title}</h3>
                    <p className="landing-body mt-1">{card.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5: CTA */}
        <CTASection />
      </main>

      <Footer />
    </div>
  );
}

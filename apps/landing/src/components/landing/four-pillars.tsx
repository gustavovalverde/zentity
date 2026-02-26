import {
  IconFileCheck,
  IconKey,
  IconLock,
  IconShieldCheck,
} from "@tabler/icons-react";

import { SectionHeader } from "@/components/landing/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colorStyles, type SemanticColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const pillars: Array<{
  icon: typeof IconShieldCheck;
  color: SemanticColor;
  title: string;
  subtitle: string;
  description: string;
  example: string;
}> = [
  {
    icon: IconShieldCheck,
    color: "purple",
    title: "Zero-Knowledge Proofs",
    subtitle: "Prove claims without revealing data",
    description:
      'Prove you\'re over 21 without showing your birthday. Prove you\'re an EU citizen without revealing which country. The verifier learns only "yes" or "no."',
    example:
      "Verifier learns: eligible. Nothing about your name, address, or birth date.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Fully Homomorphic Encryption",
    subtitle: "Compute on encrypted data",
    description:
      "Compliance checks run on encrypted attributes. The server evaluates age, liveness, and compliance thresholds without decrypting underlying values.",
    example:
      "Server computes on ciphertext. Results are decrypted with user-held keys.",
  },
  {
    icon: IconFileCheck,
    color: "emerald",
    title: "Cryptographic Commitments",
    subtitle: "Verify without storing",
    description:
      "Commitments and hashes bind verification evidence for integrity and audit without storing reversible source values.",
    example:
      "Commitments remain verifiable while sensitive profile fields stay in encrypted secrets.",
  },
  {
    icon: IconKey,
    color: "amber",
    title: "Multi-Credential Key Custody",
    subtitle: "Your keys, your control",
    description:
      "Your passkey, password, or wallet unlocks encrypted profile secrets locally. Three credential paths, one user-controlled custody model.",
    example:
      "Encrypted profile data remains locked unless the user approves credential-based unlock.",
  },
];

export function FourPillars() {
  return (
    <section className="landing-section landing-band-muted" id="how-it-works">
      <div className="landing-container">
        <SectionHeader
          title="Four cryptographic pillars for liability-free verification"
          subtitle="Built on cutting-edge privacy tech to help you stop hoarding data and ship faster."
          maxWidth="lg"
        />

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => {
            return (
              <Card key={pillar.title} className="flex h-full flex-col">
                <CardHeader className="pb-0">
                  <pillar.icon
                    className={cn(
                      "mb-4 size-6",
                      colorStyles[pillar.color].iconText,
                    )}
                  />
                  <CardTitle className="landing-card-title">
                    {pillar.title}
                  </CardTitle>
                  <p className="landing-body mt-1">{pillar.subtitle}</p>
                </CardHeader>
                <CardContent className="flex grow flex-col pt-4">
                  <p className="landing-body grow">{pillar.description}</p>
                  <div className="mt-6 border-border border-l-2 pl-4">
                    <p className="landing-body italic">{pillar.example}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

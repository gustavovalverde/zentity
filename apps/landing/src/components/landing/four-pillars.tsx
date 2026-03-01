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
      "A verifier confirms eligibility without seeing the data behind it. Prove you are over 21 without revealing your birthday. Prove EU citizenship without naming the country.",
    example:
      "Verifier learns: eligible. Nothing about your name, address, or birth date.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Fully Homomorphic Encryption",
    subtitle: "Compute on encrypted data",
    description:
      "The server evaluates compliance rules without decrypting the data. Age thresholds, liveness scores, and sanctions checks all run on ciphertexts.",
    example:
      "Server computes on ciphertext. Results are decrypted with user-held keys.",
  },
  {
    icon: IconFileCheck,
    color: "emerald",
    title: "Cryptographic Commitments",
    subtitle: "Verify without storing",
    description:
      "Evidence is bound for integrity and audit without being stored in reversible form. Commitments prove that verification happened. They cannot reveal what was verified.",
    example:
      "Commitments remain verifiable while sensitive profile fields stay in encrypted secrets.",
  },
  {
    icon: IconKey,
    color: "amber",
    title: "Multi-Credential Key Custody",
    subtitle: "Your keys, your control",
    description:
      "The server stores encrypted blobs it cannot read. Only the user's credential, whether passkey, password, or wallet, unlocks them. Three paths, one custody model.",
    example:
      "Encrypted profile data remains locked unless the user approves credential-based unlock.",
  },
];

export function FourPillars() {
  return (
    <section className="landing-section landing-band-muted" id="how-it-works">
      <div className="landing-container">
        <SectionHeader
          title="What makes verification without disclosure possible"
          subtitle="Each primitive breaks a different link between knowing data and using it. Together they ensure that verification never requires revelation."
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

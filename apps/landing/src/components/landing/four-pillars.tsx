import {
  IconFingerprint,
  IconKey,
  IconLock,
  IconShield,
} from "@tabler/icons-react";

import { ColoredIconBox } from "@/components/ui/colored-icon-box";
import { colorStyles, type SemanticColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const pillars: Array<{
  icon: typeof IconShield;
  color: SemanticColor;
  title: string;
  subtitle: string;
  description: string;
  tech: string;
  example: string;
}> = [
  {
    icon: IconShield,
    color: "purple",
    title: "Zero-Knowledge Proofs",
    subtitle: "Prove claims without revealing data",
    description:
      'Prove you\'re over 21 without showing your birthday. Prove you\'re an EU citizen without revealing which country. The verifier learns only "yes" or "no."',
    tech: "Noir circuits + UltraHonk",
    example:
      "Bouncer learns: eligible — not your name, address, or birth date.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Fully Homomorphic Encryption",
    subtitle: "Compute on encrypted data",
    description:
      "Compliance checks run on your encrypted data. The server computes age thresholds and nationality rules without ever decrypting your actual values.",
    tech: "TFHE-rs (Rust)",
    example: "Server checks: age ≥ 21? → true — never sees your birth year.",
  },
  {
    icon: IconFingerprint,
    color: "emerald",
    title: "Cryptographic Commitments",
    subtitle: "Verify without storing",
    description:
      'Your name and document number become irreversible codes. The server can verify "same person" without knowing who that person is.',
    tech: "Salted SHA256",
    example: '"John Doe" → 8f14e45f… — can\'t be reversed, GDPR-safe.',
  },
  {
    icon: IconKey,
    color: "amber",
    title: "Passkeys & Key Custody",
    subtitle: "Authenticate and seal data",
    description:
      "Your face or fingerprint unlocks your encrypted identity. Even if the server is breached, attackers get encrypted blobs they can't open.",
    tech: "WebAuthn + PRF",
    example: "Delete your passkey → your data becomes permanently unreadable.",
  },
];

export function FourPillars() {
  return (
    <section className="bg-muted/30 px-4 py-24 md:px-6" id="how-it-works">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <h2 className="font-bold text-3xl sm:text-4xl">
            Four cryptographic pillars.
            <br />
            <span className="text-muted-foreground">
              One privacy guarantee.
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Different privacy techniques for different needs—combined for
            complete protection. Key custody stays with users via passkeys.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => {
            const styles = colorStyles[pillar.color];
            return (
              <div
                key={pillar.title}
                className="flex flex-col rounded-xl border border-border bg-card/50 p-6 lg:p-8"
              >
                <ColoredIconBox
                  icon={pillar.icon}
                  color={pillar.color}
                  size="xl"
                  className="mb-4 w-fit"
                />

                <h3 className="font-semibold text-xl">{pillar.title}</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  {pillar.subtitle}
                </p>

                <p className="mt-4 flex-grow text-muted-foreground">
                  {pillar.description}
                </p>

                <div
                  className={cn(
                    "mt-6 border-l-2 pl-4",
                    styles.border.replace("/20", "/40"),
                  )}
                >
                  <p className="text-muted-foreground text-sm italic">
                    {pillar.example}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import { IconFingerprint, IconLock, IconShield } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

const pillars = [
  {
    icon: IconShield,
    color: "purple" as const,
    title: "Zero-Knowledge Proofs",
    subtitle: "Prove claims without revealing data",
    description:
      'Prove "I\'m over 18" or "I\'m in the EU" without revealing the underlying values. Proofs are cryptographically tied to verified documents.',
    tech: "Noir circuits + UltraHonk",
    example: 'Service learns: "Age verified: Yes" — nothing else.',
  },
  {
    icon: IconLock,
    color: "blue" as const,
    title: "Homomorphic Encryption",
    subtitle: "Compute on encrypted data",
    description:
      "Sensitive values stay encrypted. The server can compute, but only you can decrypt the result.",
    tech: "TFHE-rs (Rust)",
    example:
      "Server computes: encrypted value → result: true — never sees your data.",
  },
  {
    icon: IconFingerprint,
    color: "emerald" as const,
    title: "Cryptographic Commitments",
    subtitle: "Verify without storing",
    description:
      'Names and document numbers become one-way hashes. Delete the salt, and we cryptographically "forget" you.',
    tech: "Salted SHA256",
    example: '"John Doe" → 8f14e45f... — Irreversible, GDPR-friendly.',
  },
];

const colorStyles = {
  purple: {
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    text: "text-purple-400",
  },
  blue: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-400",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
  },
};

export function ThreePillars() {
  return (
    <section className="py-24 px-4 md:px-6 bg-muted/30" id="how-it-works">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Three cryptographic pillars.
            <br />
            <span className="text-muted-foreground">
              One privacy guarantee.
            </span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Different privacy techniques for different needs—combined for
            complete protection.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {pillars.map((pillar) => {
            const styles = colorStyles[pillar.color];
            return (
              <div
                key={pillar.title}
                className="rounded-xl border border-border bg-card/50 hover:bg-card transition-colors duration-300 p-6 lg:p-8 flex flex-col"
              >
                <div
                  className={cn(
                    "p-3 rounded-xl w-fit border mb-4",
                    styles.bg,
                    styles.border,
                  )}
                >
                  <pillar.icon className={cn("size-8", styles.text)} />
                </div>

                <h3 className="text-xl font-semibold">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {pillar.subtitle}
                </p>

                <p className="mt-4 text-muted-foreground flex-grow">
                  {pillar.description}
                </p>

                <div className="mt-6 pt-4 border-t border-border">
                  <div className="text-sm text-muted-foreground mb-2">
                    Example:
                  </div>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {pillar.example}
                  </code>
                </div>

                <div className="mt-4 text-sm text-muted-foreground">
                  Tech: {pillar.tech}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

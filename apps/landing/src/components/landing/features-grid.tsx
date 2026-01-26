import {
  IconCalendar,
  IconCertificate,
  IconFileText,
  IconKey,
  IconLock,
  IconMapPin,
  IconScan,
  IconTrash,
  IconUserCheck,
  IconUsers,
  IconWorld,
} from "@tabler/icons-react";
import { ColoredIconBox } from "@/components/ui/colored-icon-box";
import type { SemanticColor } from "@/lib/colors";

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  color: SemanticColor;
  title: string;
  description: string;
}

interface Category {
  title: string;
  color: SemanticColor;
  features: Feature[];
}

const categories: Category[] = [
  {
    title: "Verify Identity",
    color: "purple",
    features: [
      {
        icon: IconCalendar,
        color: "purple",
        title: "Age Verification",
        description: "Prove 18+, 21+, or 25+ with privacy-preserving proofs.",
      },
      {
        icon: IconFileText,
        color: "blue",
        title: "Document Verification",
        description:
          "OCR extracts minimum fields. Images are discarded after processing.",
      },
      {
        icon: IconScan,
        color: "orange",
        title: "Liveness Detection",
        description: "Signed liveness scores with encrypted attributes.",
      },
      {
        icon: IconMapPin,
        color: "emerald",
        title: "Address Jurisdiction",
        description:
          "Prove you live in an allowed region without revealing your address.",
      },
    ],
  },
  {
    title: "Protect Data",
    color: "blue",
    features: [
      {
        icon: IconLock,
        color: "blue",
        title: "Multi-Credential Vault",
        description:
          "Passkey, password, or wallet locks your vault. Server stores encrypted blobs it can't read.",
      },
      {
        icon: IconUserCheck,
        color: "pink",
        title: "Face Matching",
        description: "Embeddings computed and immediately deleted.",
      },
      {
        icon: IconWorld,
        color: "purple",
        title: "Nationality Proofs",
        description: "Prove EU membership without revealing your country.",
      },
      {
        icon: IconUsers,
        color: "amber",
        title: "Guardian Recovery",
        description:
          "Trusted contacts help recover your keys via threshold signatures. No single point of failure.",
      },
    ],
  },
  {
    title: "Stay Compliant",
    color: "emerald",
    features: [
      {
        icon: IconTrash,
        color: "red",
        title: "GDPR Compliance",
        description: "Delete the sealed profile = cryptographic erasure.",
      },
      {
        icon: IconKey,
        color: "yellow",
        title: "Audit Bundles",
        description: "Audit-ready evidence packs without raw PII.",
      },
      {
        icon: IconCertificate,
        color: "purple",
        title: "Verifiable Credentials",
        description:
          "Issue and present SD-JWT credentials via OIDC4VCI/VP standards.",
      },
    ],
  },
];

function CategoryColumn({ category }: { category: Category }) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-wider">
        {category.title}
      </h3>
      <div className="space-y-3">
        {category.features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <ColoredIconBox
                icon={feature.icon}
                color={feature.color}
                size="sm"
                className="h-9 w-9"
              />
              <div>
                <h4 className="font-medium">{feature.title}</h4>
                <p className="mt-0.5 text-muted-foreground text-sm">
                  {feature.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeaturesGrid() {
  const [verifyIdentity, protectData, stayCompliant] = categories;

  return (
    <section className="px-4 py-24 md:px-6" id="features">
      <div className="mx-auto max-w-4xl">
        <div className="mb-16 text-center">
          <h2 className="font-bold text-3xl sm:text-4xl">
            11 privacy features, zero plaintext PII stored
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Complete identity verification without the privacy trade-offs.
          </p>
        </div>

        {/* Row 1: Verify Identity + Protect Data */}
        <div className="grid gap-8 md:grid-cols-2">
          <CategoryColumn category={verifyIdentity} />
          <CategoryColumn category={protectData} />
        </div>

        {/* Row 2: Stay Compliant (centered) */}
        <div className="mt-8 flex justify-center">
          <div className="w-full md:w-1/2">
            <CategoryColumn category={stayCompliant} />
          </div>
        </div>
      </div>
    </section>
  );
}

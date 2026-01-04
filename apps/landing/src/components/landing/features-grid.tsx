import {
  IconCalendar,
  IconFileText,
  IconKey,
  IconLock,
  IconScan,
  IconTrash,
  IconUserCheck,
  IconWorld,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

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
  orange: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    text: "text-orange-400",
  },
  pink: {
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    text: "text-pink-400",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
  },
  yellow: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    text: "text-yellow-400",
  },
  red: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-400",
  },
};

type ColorKey = keyof typeof colorStyles;

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  color: ColorKey;
  title: string;
  description: string;
}

interface Category {
  title: string;
  color: ColorKey;
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
        description: "OCR extracts minimum fields. Documents never stored.",
      },
      {
        icon: IconScan,
        color: "orange",
        title: "Liveness Detection",
        description: "Liveness checks with encrypted scoring.",
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
        title: "Encrypted Storage",
        description: "Encrypted data that only the user can decrypt.",
      },
      {
        icon: IconUserCheck,
        color: "pink",
        title: "Face Matching",
        description: "Embeddings computed and immediately deleted.",
      },
      {
        icon: IconWorld,
        color: "emerald",
        title: "Nationality Proofs",
        description: "Prove EU membership without revealing your country.",
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
        description: "Delete salt = cryptographically forgotten.",
      },
      {
        icon: IconKey,
        color: "yellow",
        title: "Audit Bundles",
        description: "Audit-ready proof bundles without raw PII.",
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
        {category.features.map((feature) => {
          const featureStyles = colorStyles[feature.color];
          return (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                    featureStyles.bg,
                    featureStyles.border,
                  )}
                >
                  <feature.icon className={cn("size-4", featureStyles.text)} />
                </div>
                <div>
                  <h4 className="font-medium">{feature.title}</h4>
                  <p className="mt-0.5 text-muted-foreground text-sm">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
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
            8 verification features, zero raw data stored
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

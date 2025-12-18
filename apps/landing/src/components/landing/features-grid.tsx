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
        description: "Prove 18+, 21+, or 25+ without revealing your birthday.",
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
        description: "Multi-gesture challenges prove you're real.",
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
        description: "Data stored as FHE ciphertexts—never decrypted.",
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
        description: "Prove EU citizen without revealing country.",
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
        title: "OAuth Integration",
        description: "Familiar redirect flows and one-time codes.",
      },
    ],
  },
];

function CategoryColumn({ category }: { category: Category }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {category.title}
      </h3>
      <div className="space-y-3">
        {category.features.map((feature) => {
          const featureStyles = colorStyles[feature.color];
          return (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors"
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
                  <p className="text-sm text-muted-foreground mt-0.5">
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
    <section className="py-24 px-4 md:px-6" id="features">
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold sm:text-4xl">
            8 verification features, zero data stored
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Complete identity verification without the privacy trade-offs.
          </p>
        </div>

        {/* Row 1: Verify Identity + Protect Data */}
        <div className="grid md:grid-cols-2 gap-8">
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

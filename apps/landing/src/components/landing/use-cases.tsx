import {
  IconBriefcase,
  IconCurrencyBitcoin,
  IconGlass,
  IconWorld,
} from "@tabler/icons-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const colorStyles = {
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

const useCases = [
  {
    icon: IconCurrencyBitcoin,
    color: "orange" as const,
    title: "Crypto Exchanges",
    description:
      "Comply with MiCA & FATF Travel Rule using proofs instead of raw PII.",
  },
  {
    icon: IconGlass,
    color: "pink" as const,
    title: "Age-Restricted Services",
    description:
      "Verify age for alcohol, gambling, or adult content while learning nothing else about the user.",
  },
  {
    icon: IconBriefcase,
    color: "blue" as const,
    title: "Cross-Border Hire",
    description:
      "Verify right-to-work status or accreditation without storing passport scans.",
  },
  {
    icon: IconWorld,
    color: "emerald" as const,
    title: "EU Residency",
    description:
      "Prove EU residency without revealing the specific country of origin.",
  },
];

export function UseCases() {
  return (
    <section className="py-24 overflow-hidden" id="use-cases">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold">
            Built for Real World Privacy
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Where data minimization meets regulatory compliance.
          </p>
        </div>

        {/* 2x2 Grid Layout */}
        <div className="grid md:grid-cols-2 gap-6">
          {useCases.map((useCase) => {
            const styles = colorStyles[useCase.color];
            return (
              <Card
                key={useCase.title}
                className="h-full border-border bg-card/50 hover:bg-card transition-colors"
              >
                <CardHeader className="flex flex-row items-center gap-4">
                  <div
                    className={cn(
                      "p-2 rounded-lg border",
                      styles.bg,
                      styles.border,
                    )}
                  >
                    <useCase.icon className={cn("h-6 w-6", styles.text)} />
                  </div>
                  <CardTitle className="text-lg">{useCase.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    {useCase.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import {
  IconBriefcase,
  IconCurrencyBitcoin,
  IconGlass,
  IconPlugConnected,
  IconWallet,
  IconWorld,
} from "@tabler/icons-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colorStyles, type SemanticColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const useCases: Array<{
  icon: typeof IconCurrencyBitcoin;
  color: SemanticColor;
  title: string;
  description: string;
}> = [
  {
    icon: IconCurrencyBitcoin,
    color: "orange",
    title: "Crypto Exchanges",
    description:
      "Comply with MiCA & FATF Travel Rule using proofs, with passkey-consented disclosure when required.",
  },
  {
    icon: IconGlass,
    color: "pink",
    title: "Age-Restricted Services",
    description:
      "Verify age for alcohol, gambling, or adult content while learning nothing else about the user.",
  },
  {
    icon: IconBriefcase,
    color: "blue",
    title: "Cross-Border Hire",
    description:
      "Verify right-to-work status without storing passport scans or plaintext data.",
  },
  {
    icon: IconWorld,
    color: "emerald",
    title: "EU Residency",
    description: "Prove EU residency while keeping exact country private.",
  },
  {
    icon: IconPlugConnected,
    color: "purple",
    title: "OAuth Provider",
    description:
      "Let partner apps request proofs (age, nationality, compliance level) without exposing your documents or biometrics.",
  },
  {
    icon: IconWallet,
    color: "amber",
    title: "Credential Portability",
    description:
      "Take your verified credentials to any compatible wallet. No re-verification needed across services.",
  },
];

export function UseCases() {
  return (
    <section className="overflow-hidden py-24" id="use-cases">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        <div className="mb-16 text-center">
          <h2 className="font-bold text-3xl md:text-4xl">
            Built for Real World Privacy
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Where data minimization meets regulatory compliance.
          </p>
        </div>

        {/* 2x2 Grid Layout */}
        <div className="grid gap-6 md:grid-cols-2">
          {useCases.map((useCase) => {
            const styles = colorStyles[useCase.color];
            return (
              <Card
                key={useCase.title}
                className="h-full border-border bg-card/50"
              >
                <CardHeader className="flex flex-row items-center gap-4">
                  <div
                    className={cn(
                      "rounded-lg border p-2",
                      styles.bg,
                      styles.border,
                    )}
                  >
                    <useCase.icon className={cn("h-6 w-6", styles.iconText)} />
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

import {
  IconBuildingBank,
  IconCurrencyBitcoin,
  IconGlass,
  IconPlugConnected,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react";

import { SectionHeader } from "@/components/landing/section-header";
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
      "Meet MiCA and FATF Travel Rule requirements with proof-first checks, then request identity details only when required.",
  },
  {
    icon: IconBuildingBank,
    color: "orange",
    title: "Digital Banking Step-Up",
    description:
      "Start with quick verification checks, then ask for identity details only at account opening when policy requires it.",
  },
  {
    icon: IconGlass,
    color: "pink",
    title: "Age-Restricted Commerce",
    description:
      "Prove age eligibility for checkout without revealing full identity by default.",
  },
  {
    icon: IconShieldCheck,
    color: "purple",
    title: "Humanitarian Aid Eligibility",
    description:
      "Verify beneficiary eligibility with minimal data sharing and user consent for additional details.",
  },
  {
    icon: IconPlugConnected,
    color: "purple",
    title: "OAuth/OIDC Identity Layer",
    description:
      "Use one OAuth/OIDC integration for sign-in and identity verification.",
  },
  {
    icon: IconWallet,
    color: "amber",
    title: "Credential Portability",
    description:
      "Issue wallet-compatible credentials via OIDC4VCI/VP/IDA so users can reuse verification results across compatible services.",
  },
];

export function UseCases() {
  return (
    <section
      className="landing-section landing-band-flat overflow-hidden"
      id="use-cases"
    >
      <div className="landing-container">
        <SectionHeader
          title="Built for real-world privacy"
          subtitle="Practical examples that balance user privacy and regulatory requirements"
        />

        <div className="grid gap-6 md:grid-cols-2">
          {useCases.map((useCase) => (
            <Card key={useCase.title} className="h-full">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <useCase.icon
                    className={cn(
                      "size-5",
                      colorStyles[useCase.color].iconText,
                    )}
                  />
                  <CardTitle className="landing-card-title">
                    {useCase.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                <p className="landing-body">{useCase.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

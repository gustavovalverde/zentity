import {
  IconArrowRight,
  IconBuildingBank,
  IconCurrencyBitcoin,
  IconGlass,
  IconPlugConnected,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";

import { SectionHeader } from "@/components/landing/section-header";
import { buttonVariants } from "@/components/ui/button";
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
      "ZK proofs confirm sanctions compliance. FHE runs ongoing screening on encrypted data. Identity details are requested only when regulation requires it.",
  },
  {
    icon: IconBuildingBank,
    color: "orange",
    title: "Digital Banking Step-Up",
    description:
      "Trust is spatial: viewing a balance needs basic login, wiring funds needs document-verified identity. One OAuth scope model handles both.",
  },
  {
    icon: IconGlass,
    color: "pink",
    title: "Age-Restricted Commerce",
    description:
      "A threshold proof on age. The retailer learns 'old enough' and nothing else. No document copies, no PII liability.",
  },
  {
    icon: IconShieldCheck,
    color: "purple",
    title: "Humanitarian Aid",
    description:
      "Biometric nullifiers prevent duplicate claims without a name database. Threshold keys ensure beneficiaries keep control in unstable environments.",
  },
  {
    icon: IconPlugConnected,
    color: "purple",
    title: "Zero-Knowledge SSO",
    description:
      "Standard OAuth redirect. Pairwise pseudonyms per relying party. ZK proofs instead of PII in tokens. No custom protocol.",
  },
  {
    icon: IconWallet,
    color: "amber",
    title: "Credential Portability",
    description:
      "SD-JWT credentials issued via OIDC4VCI. Users choose which claims to present at each service through selective disclosure.",
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
          title="Where this applies"
          subtitle="These scenarios vary in what needs to be verified and how deeply the verifier needs to see. The same four mechanisms power all of them."
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

        <div className="mt-8 text-center">
          <Link
            to="/capabilities"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-9 rounded-sm px-4",
            )}
          >
            See all capabilities
            <IconArrowRight className="ml-2 size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

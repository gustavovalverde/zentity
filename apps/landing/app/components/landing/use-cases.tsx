import {
  IconArrowRight,
  IconBuildingBank,
  IconGlass,
  IconLock,
  IconPlugConnected,
  IconRobot,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { SectionHeader } from "@/components/landing/section-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colorStyles, type SemanticColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

const useCases: Array<{
  icon: typeof IconShieldCheck;
  color: SemanticColor;
  title: string;
  description: string;
  cluster: string;
}> = [
  {
    icon: IconGlass,
    color: "pink",
    title: "Age-Restricted Access",
    cluster: "Threshold Proofs",
    description:
      "A retailer, a platform, or a regulator needs to know 'old enough.' The date of birth is irrelevant to the decision. A threshold proof answers the question without creating the liability.",
  },
  {
    icon: IconShieldCheck,
    color: "purple",
    title: "Jurisdiction Eligibility",
    cluster: "Threshold Proofs",
    description:
      "A crypto exchange needs 'eligible jurisdiction.' Which country is irrelevant to the transfer. A Merkle membership proof confirms group inclusion without naming the member.",
  },
  {
    icon: IconBuildingBank,
    color: "orange",
    title: "Banking Step-Up",
    cluster: "Graduated Trust",
    description:
      "Viewing a balance requires basic login. Wiring funds requires document-verified identity. The scope model handles both without treating every user as a compliance case from the start.",
  },
  {
    icon: IconLock,
    color: "blue",
    title: "Compliance-Gated Finance",
    cluster: "Graduated Trust",
    description:
      "Sanctions screening, ongoing monitoring, and Travel Rule reporting need encrypted attributes that can be re-evaluated without re-collecting. FHE computation addresses this without storing plaintext.",
  },
  {
    icon: IconRobot,
    color: "orange",
    title: "Agent Delegation",
    cluster: "Bound Delegation",
    description:
      "An AI agent needs the human's name to ship a package. CIBA sends a push notification; the human approves and unlocks their vault. The agent receives a one-time release handle, never the raw identity.",
  },
  {
    icon: IconPlugConnected,
    color: "purple",
    title: "Portable Verification",
    cluster: "Portable Trust",
    description:
      "Standard OAuth redirect with pairwise pseudonyms, or SD-JWT credentials the user carries between services. Either way, each relying party sees only the claims the user approves, and cross-service correlation is impossible.",
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
          title="Scenarios where verification must not require revelation"
          subtitle="These scenarios share a structural need: proving a fact without disclosing the data behind it. What varies is the fact being proved, the depth of disclosure required, and the stakes of a privacy failure."
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
                  <div>
                    <p className="landing-caption font-medium">
                      {useCase.cluster}
                    </p>
                    <CardTitle className="landing-card-title">
                      {useCase.title}
                    </CardTitle>
                  </div>
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
            See the full scenario taxonomy
            <IconArrowRight className="ml-2 size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

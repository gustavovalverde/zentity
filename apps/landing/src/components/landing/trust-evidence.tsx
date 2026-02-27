import {
  IconBuildingBank,
  IconCheck,
  IconCode,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";

import { SectionHeader } from "@/components/landing/section-header";
import { StepTimeline } from "@/components/landing/step-timeline";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
} from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { colorStyles } from "@/lib/colors";
import { iconSemanticColors } from "@/lib/icon-semantics";
import { cn } from "@/lib/utils";

type AudienceId = "users" | "companies" | "developers";

const audienceContent: Array<{
  id: AudienceId;
  icon: typeof IconBuildingBank;
  iconColor: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  flow: Array<{
    title: string;
    detail: string;
  }>;
  outcome: string;
}> = [
  {
    id: "users",
    icon: IconShieldCheck,
    iconColor: iconSemanticColors.shield,
    label: "Users",
    title: "Will this expose my identity?",
    description:
      "No. Most checks return a simple result first. Personal details are requested only when policy or law requires it.",
    bullets: [
      "Each request is limited to what that service needs.",
      "Personal details require explicit consent each time.",
      "Document images and selfies are processed and discarded.",
    ],
    ctaLabel: "Read privacy boundaries",
    ctaHref: "/docs/attestation-privacy",
    flow: [
      {
        title: "Service requests eligibility proof",
        detail: "The service asks for a minimal verification result first.",
      },
      {
        title: "User reviews and consents",
        detail:
          "The user sees exactly what is being requested before any personal detail is shared.",
      },
      {
        title: "Proof result is returned",
        detail:
          "The service receives a yes/no style result for the requested policy.",
      },
      {
        title: "Identity disclosure is optional",
        detail: "Extra identity fields are requested only when required.",
      },
    ],
    outcome: "Users get verified without becoming a reusable identity record.",
  },
  {
    id: "companies",
    icon: IconBuildingBank,
    iconColor: iconSemanticColors.company,
    label: "Companies",
    title: "Can we satisfy compliance without collecting everything?",
    description:
      "Yes. Banks, exchanges, and other services can meet policy requirements without collecting full identity data by default.",
    bullets: [
      "One integration path replaces separate auth and KYC systems.",
      "Responses include decision context for audits.",
      "Requests stay limited to what each flow needs.",
    ],
    ctaLabel: "Read compliance mapping",
    ctaHref: "/#compliance",
    flow: [
      {
        title: "Define policy requirements",
        detail: "Teams define which checks are required for each flow.",
      },
      {
        title: "Request scoped evidence",
        detail: "The service requests only the evidence tied to that decision.",
      },
      {
        title: "Receive verification + audit context",
        detail: "Responses include policy outcomes and audit context.",
      },
      {
        title: "Escalate only when mandated",
        detail:
          "Direct identity disclosure is reserved for legally required cases.",
      },
    ],
    outcome:
      "Companies satisfy onboarding and AML controls without default oversharing.",
  },
  {
    id: "developers",
    icon: IconCode,
    iconColor: iconSemanticColors.developer,
    label: "Developers",
    title: "Can we integrate without rebuilding auth?",
    description:
      "Yes. Integration stays close to standard OAuth/OIDC patterns, including dynamic client registration and scoped claim responses.",
    bullets: [
      "Request only the proof and identity permissions your app needs.",
      "Proof results are returned in userinfo based on approved scopes.",
      "Identity fields are returned in id_token only after user consent.",
    ],
    ctaLabel: "Open OAuth integration docs",
    ctaHref: "/docs/oauth-integrations",
    flow: [
      {
        title: "Connect with standard OAuth/OIDC",
        detail: "Start from familiar auth and client registration patterns.",
      },
      {
        title: "Request only needed claims",
        detail:
          "Ask for proof or identity scopes based on each product action.",
      },
      {
        title: "Consume filtered responses",
        detail:
          "Userinfo and tokens return only approved data for that transaction.",
      },
      {
        title: "Reuse existing application stack",
        detail:
          "No custom protocol is needed to combine auth and verification.",
      },
    ],
    outcome:
      "Developers ship verification quickly without replacing their auth foundation.",
  },
];

export function TrustEvidence() {
  return (
    <section className="landing-section landing-band-flat" id="audiences">
      <div className="landing-container">
        <SectionHeader
          title="What each audience gets"
          subtitle="One sign-in and verification flow for everyone. Start with simple proof results, then request personal details only when needed and approved."
          maxWidth="lg"
        />

        <Tabs defaultValue="users" className="landing-card p-4 md:p-6">
          <div className="mb-6">
            <TabsList className="h-auto w-full flex-nowrap justify-between gap-1 rounded-2xl border border-border bg-muted p-1 md:rounded-full">
              {audienceContent.map((audience) => (
                <TabsTrigger
                  key={audience.id}
                  value={audience.id}
                  className="rounded-full px-2 py-2 text-xs sm:px-3 sm:text-sm md:px-6"
                >
                  <audience.icon
                    className={cn("size-3.5 sm:size-4", audience.iconColor)}
                  />
                  {audience.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {audienceContent.map((audience) => (
            <TabsContent key={audience.id} value={audience.id} className="mt-0">
              <div className="landing-grid-2">
                <Card className="order-1 lg:order-2">
                  <CardContent className="p-5">
                    <StepTimeline
                      label={`${audience.label.toLowerCase()}-flow`}
                      steps={audience.flow}
                    />

                    <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                      <p className="font-medium text-sm">Outcome</p>
                      <p className="landing-body mt-1">{audience.outcome}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="order-2 lg:order-1">
                  <CardHeader className="pb-0">
                    <CardTitle className="landing-card-title">
                      {audience.title}
                    </CardTitle>
                    <p className="landing-body mt-3 max-w-xl">
                      {audience.description}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-5">
                    <ItemGroup>
                      {audience.bullets.map((item) => (
                        <div
                          key={item}
                          className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-2.5"
                        >
                          <ItemMedia>
                            <IconCheck
                              className={cn(
                                "size-4",
                                colorStyles.emerald.iconText,
                              )}
                            />
                          </ItemMedia>
                          <ItemContent>
                            <ItemDescription className="mt-0">
                              {item}
                            </ItemDescription>
                          </ItemContent>
                        </div>
                      ))}
                    </ItemGroup>

                    <Link
                      to={audience.ctaHref}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "mt-6 h-9 rounded-sm px-4",
                      )}
                    >
                      {audience.ctaLabel}
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

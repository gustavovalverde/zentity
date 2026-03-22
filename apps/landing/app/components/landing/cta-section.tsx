import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router";

import { SectionHeader } from "@/components/landing/section-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CTASection() {
  return (
    <section className="landing-section landing-band-flat">
      <div className="landing-container">
        <Card>
          <CardContent className="p-7 md:p-10">
            <SectionHeader
              title="Integrate verification without collection into your stack"
              subtitle="Start with the demo to see the full verification flow, then integrate via standard OAuth 2.1"
              maxWidth="lg"
              className="mb-8"
            />

            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://demo.zentity.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 px-7 text-base",
                )}
              >
                Try the Demo
                <IconArrowRight className="ml-2 size-4" />
              </a>
              <Link
                to="/docs/oauth-integrations"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-11 px-7 text-base",
                )}
              >
                Read Integration Guide
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

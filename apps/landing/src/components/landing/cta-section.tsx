import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";

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
              title="Validate Zentity in your own relying-party flow"
              subtitle="Start with the live demo, then review integration and compliance details in the technical docs"
              maxWidth="lg"
              className="mb-8"
            />

            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://app.zentity.xyz/sign-up?fresh=1"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 px-7 text-base",
                )}
              >
                Explore the Demo
                <IconArrowRight className="ml-2 size-4" />
              </a>
              <Link
                to="/docs/architecture"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-11 px-7 text-base",
                )}
              >
                Read Architecture
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

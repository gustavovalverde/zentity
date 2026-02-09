import {
  IconCheck,
  IconExternalLink,
  IconPlayerPlay,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { ColoredIconBox } from "@/components/ui/colored-icon-box";
import { colorStyles } from "@/lib/colors";
import { cn } from "@/lib/utils";

const trustPoints = [
  {
    title: "Auditable by design",
    description:
      "Every cryptographic operation is verifiable. Privacy you can prove.",
  },
  {
    title: "No vendor lock-in",
    description:
      "Self-host with Docker Compose. Your infrastructure, your control.",
  },
  {
    title: "Standards-based",
    description:
      "Built on open standards: OAuth 2.1, OIDC, SD-JWT, OIDC4VCI/VP.",
  },
];

export function CTASection() {
  return (
    <section className="px-4 py-24 md:px-6">
      <div className="mx-auto max-w-4xl">
        {/* Open Source Badge + Headline */}
        <div className="text-center">
          <Badge variant="outline" className="mb-4">
            Privacy First
          </Badge>
          <h2 className="font-bold text-3xl sm:text-4xl">
            Cryptographic privacy.
            <br />
            <span className="text-muted-foreground">Zero lock-in.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Every privacy guarantee is mathematically enforced. Audit the
            cryptography. Self-host on your own infrastructure.
          </p>
        </div>

        {/* Trust Points */}
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-3">
          {trustPoints.map((point) => (
            <div key={point.title} className="flex items-start gap-3">
              <IconCheck
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  colorStyles.emerald.iconText,
                )}
              />
              <div>
                <div className="font-medium">{point.title}</div>
                <div className="mt-0.5 text-muted-foreground text-sm">
                  {point.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Standards Interop */}
        <div className="mx-auto mt-12 max-w-2xl rounded-xl border border-border bg-muted/30 p-6 text-center">
          <p className="font-medium text-foreground">
            This isn't theoretical. It's running code.
          </p>
          <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
            Same passkeys as Apple, Google, and Microsoft. Same wallets as
            Ethereum. Same credential standards as EUDI. Built on OAuth 2.1,
            OpenID Connect, and open specifications.
          </p>
        </div>

        {/* CTA Cards */}
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-3">
          {/* Try Demo */}
          <a
            href="https://app.zentity.xyz/sign-up?fresh=1"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "group block rounded-xl border border-border bg-card p-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "hover:border-purple-500/50",
            )}
          >
            <ColoredIconBox
              icon={IconPlayerPlay}
              color="purple"
              size="lg"
              className="mb-4 h-12 w-12 group-hover:bg-purple-500/20"
            />
            <h3 className="mb-2 font-semibold">Try the Demo</h3>
            <p className="grow text-muted-foreground text-sm">
              Full verification flow in 60 seconds.
            </p>
            <span className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm">
              Launch Demo
            </span>
          </a>

          {/* Contact */}
          <a
            href="mailto:hello@zentity.xyz"
            className={cn(
              "group block rounded-xl border border-border bg-card p-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "hover:border-blue-500/50",
            )}
          >
            <ColoredIconBox
              icon={IconExternalLink}
              color="blue"
              size="lg"
              className="mb-4 h-12 w-12 group-hover:bg-blue-500/20"
            />
            <h3 className="mb-2 font-semibold">Get in Touch</h3>
            <p className="grow text-muted-foreground text-sm">
              Enterprise integrations, partnerships, or questions.
            </p>
            <span className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 font-medium text-sm hover:bg-accent hover:text-accent-foreground">
              Contact Us
            </span>
          </a>

          {/* Learn More */}
          <a
            href="#architecture"
            className={cn(
              "group block rounded-xl border border-border bg-card p-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "hover:border-emerald-500/50",
            )}
          >
            <ColoredIconBox
              icon={IconExternalLink}
              color="emerald"
              size="lg"
              className="mb-4 h-12 w-12 group-hover:bg-emerald-500/20"
            />
            <h3 className="mb-2 font-semibold">See How It Works</h3>
            <p className="grow text-muted-foreground text-sm">
              Explore the privacy architecture.
            </p>
            <span className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 font-medium text-sm hover:bg-accent hover:text-accent-foreground">
              Technical Deep-Dive
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

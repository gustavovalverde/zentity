import {
  IconArrowRight,
  IconBook2,
  IconCertificate,
  IconFileCheck,
  IconKey,
  IconLock,
  IconShieldCheck,
} from "@tabler/icons-react";

import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { iconSemanticColors } from "@/lib/icon-semantics";
import { cn } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative flex min-h-[90vh] items-center justify-center overflow-hidden px-4 pt-20 md:px-6 md:pt-24">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,oklch(0.9_0.04_220)_0%,transparent_42%),radial-gradient(circle_at_82%_84%,oklch(0.9_0.04_170)_0%,transparent_38%)] dark:bg-[radial-gradient(circle_at_20%_15%,oklch(0.22_0.04_220)_0%,transparent_42%),radial-gradient(circle_at_82%_84%,oklch(0.22_0.04_170)_0%,transparent_38%)]" />
      </div>

      <div className="mx-auto max-w-4xl text-center lg:max-w-5xl">
        <Badge
          variant="outline"
          className="mb-6 inline-flex items-center justify-center gap-2 rounded-full border-border bg-background/50 px-4 py-1.5 text-sm leading-none backdrop-blur-sm"
        >
          <span aria-hidden="true" className="relative inline-flex size-2.5">
            <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-green-500/40" />
            <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
          </span>
          <span className="leading-none">Pre-Audit Beta</span>
        </Badge>

        <h1 className="font-display font-semibold text-5xl leading-[0.98] tracking-tight sm:text-7xl lg:text-8xl">
          Privacy by default
          <br />
          <span className="text-muted-foreground">Disclosure by choice</span>
        </h1>

        <p className="mx-auto mt-8 max-w-3xl text-muted-foreground text-xl leading-9 sm:text-2xl">
          Identity verification requires sharing data to prove anything about
          it. Zentity is the cryptographic layer that separates the two. Verify
          once through any provider, then produce proofs on demand. The verifier
          learns the answer. Nothing else.
        </p>

        <div className="mx-auto mt-8 grid max-w-5xl gap-2 text-muted-foreground text-sm sm:text-base md:grid-cols-[auto_auto] md:justify-center md:gap-x-10 md:gap-y-3">
          <p className="text-center">
            <span className="font-semibold text-foreground">Users</span> - prove
            facts without revealing data
          </p>
          <p className="text-center">
            <span className="font-semibold text-foreground">Companies</span> -
            verify without collecting
          </p>
          <p className="text-center md:col-span-2 md:justify-self-center">
            <span className="font-semibold text-foreground">Developers</span> -
            integrate with standard OAuth/OIDC
          </p>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="https://demo.zentity.xyz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Try the Demo"
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
            <IconBook2 className="mr-2 size-4" />
            Read Integration Guide
          </Link>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-7 gap-y-4 text-muted-foreground text-sm sm:text-base">
          <div className="flex items-center gap-2">
            <IconShieldCheck
              className={cn("size-4", iconSemanticColors.shield)}
            />
            <span>Zero-Knowledge Proofs</span>
          </div>
          <div className="flex items-center gap-2">
            <IconLock className={cn("size-4", iconSemanticColors.lock)} />
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="flex items-center gap-2">
            <IconFileCheck
              className={cn("size-4", iconSemanticColors.commitment)}
            />
            <span>Cryptographic Commitments</span>
          </div>
          <div className="flex items-center gap-2">
            <IconKey className={cn("size-4", iconSemanticColors.key)} />
            <span>Multi-Credential Vaults</span>
          </div>
          <div className="flex items-center gap-2">
            <IconCertificate
              className={cn("size-4", iconSemanticColors.oauth)}
            />
            <span>OIDC4VCI/VP/IDA</span>
          </div>
        </div>
      </div>
    </section>
  );
}

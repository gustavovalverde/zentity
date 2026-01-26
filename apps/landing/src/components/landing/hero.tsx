import {
  IconBrandGithub,
  IconExternalLink,
  IconFileCheck,
  IconKey,
  IconLock,
  IconShield,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColoredIconBox } from "@/components/ui/colored-icon-box";

export function Hero() {
  return (
    <section className="relative flex min-h-[90vh] items-center justify-center px-4 pt-16">
      {/* Gradient Background */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 h-[500px] w-full -translate-x-1/2 bg-gradient-to-b from-primary/20 via-blue-900/10 to-transparent blur-[100px]" />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <Badge
          variant="outline"
          className="mb-6 border-border bg-background/50 px-4 py-1.5 text-sm backdrop-blur-sm"
        >
          <span className="mr-2 inline-flex items-center">
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"
              aria-hidden="true"
            />
            <span className="sr-only">Status: Active</span>
          </span>
          Open Source Alpha
        </Badge>

        <h1 className="mb-6 bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text font-extrabold text-5xl text-transparent tracking-tight md:text-7xl">
          Prove everything.
          <br className="hidden md:block" />
          Reveal nothing.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-7 sm:text-xl">
          Identity verification that stores encrypted proofs, not plaintext PII.
          Same compliance. No honeypot.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-muted-foreground text-xs">
          <span>
            <span className="font-medium text-foreground">Compliance</span> —
            minimize PII exposure
          </span>
          <span>
            <span className="font-medium text-foreground">Product</span> —
            drop-in verification
          </span>
          <span>
            <span className="font-medium text-foreground">Engineering</span> —
            open source stack
          </span>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            size="lg"
            className="w-full px-8 text-base sm:w-auto"
            render={
              /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
              <a
                href="https://app.zentity.xyz/sign-up?fresh=1"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Try Live Demo"
              />
            }
          >
            Try Live Demo
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full px-8 text-base sm:w-auto"
            render={
              /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
              <a
                href="https://github.com/gustavovalverde/zentity"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on GitHub"
              />
            }
          >
            <IconBrandGithub className="mr-2 size-5" />
            View on GitHub
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full text-base sm:w-auto"
            render={
              /* biome-ignore lint/a11y/useAnchorContent: Content provided by Button children via render prop */
              <a href="/docs" aria-label="Read documentation" />
            }
          >
            Read Docs
            <IconExternalLink className="ml-2 size-4" />
          </Button>
        </div>

        {/* Trust Signal */}
        <div className="mt-16 flex flex-col items-center gap-4">
          <div className="flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <ColoredIconBox icon={IconShield} color="purple" size="sm" />
              <span className="text-muted-foreground">
                Zero-Knowledge Proofs
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ColoredIconBox icon={IconLock} color="blue" size="sm" />
              <span className="text-muted-foreground">
                Fully Homomorphic Encryption
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ColoredIconBox icon={IconFileCheck} color="emerald" size="sm" />
              <span className="text-muted-foreground">
                Cryptographic Commitments
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ColoredIconBox icon={IconKey} color="amber" size="sm" />
              <span className="text-muted-foreground">
                Multi-Credential Vaults
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

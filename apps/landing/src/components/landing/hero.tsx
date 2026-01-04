import {
  IconBrandGithub,
  IconExternalLink,
  IconFileCheck,
  IconLock,
  IconShield,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
          Open Source Alpha
        </Badge>

        <h1 className="mb-6 bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text font-extrabold text-5xl text-transparent tracking-tight md:text-7xl">
          Prove everything.
          <br className="hidden md:block" />
          Reveal nothing.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-8 sm:text-xl">
          Privacy-first identity verification for banks, exchanges, and
          Web3—prove age, nationality, and liveness without exposing or storing
          plaintext personal data.
        </p>

        <p className="mt-4 text-muted-foreground text-sm">
          Passkey-sealed profiles + zero-knowledge proofs + homomorphic
          encryption. 100% open source.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="https://app.zentity.xyz/sign-up?fresh=1"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="w-full px-8 text-base sm:w-auto">
              Try Live Demo
            </Button>
          </a>
          <a
            href="https://github.com/gustavovalverde/zentity"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              size="lg"
              className="w-full px-8 text-base sm:w-auto"
            >
              <IconBrandGithub className="mr-2 size-5" />
              View on GitHub
            </Button>
          </a>
          <a
            href="https://github.com/gustavovalverde/zentity/tree/main/docs"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="ghost"
              size="lg"
              className="w-full text-base sm:w-auto"
            >
              Read Docs
              <IconExternalLink className="ml-2 size-4" />
            </Button>
          </a>
        </div>

        {/* Trust Signal */}
        <div className="mt-16 flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">
            Built with privacy-preserving cryptography
          </p>
          <div className="flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <div className="rounded-md border border-purple-500/20 bg-purple-500/10 p-1.5">
                <IconShield className="size-4 text-purple-400" />
              </div>
              <span className="text-muted-foreground">
                Zero-Knowledge Proofs
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-1.5">
                <IconLock className="size-4 text-blue-400" />
              </div>
              <span className="text-muted-foreground">
                Homomorphic Encryption
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-1.5">
                <IconFileCheck className="size-4 text-emerald-400" />
              </div>
              <span className="text-muted-foreground">
                Cryptographic Commitments
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

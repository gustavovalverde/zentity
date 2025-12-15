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
    <section className="relative min-h-[90vh] flex items-center justify-center px-4 pt-16">
      {/* Gradient Background */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-gradient-to-b from-primary/20 via-blue-900/10 to-transparent blur-[100px]" />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <Badge
          variant="outline"
          className="mb-6 py-1.5 px-4 text-sm bg-background/50 backdrop-blur-sm border-border"
        >
          <span className="mr-2 h-2 w-2 rounded-full bg-green-500 inline-block animate-pulse" />
          Open Source Alpha
        </Badge>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
          Prove everything.
          <br className="hidden md:block" />
          Reveal nothing.
        </h1>

        <p className="mt-6 text-lg sm:text-xl leading-8 text-muted-foreground max-w-2xl mx-auto">
          Identity verification that proves what you need—like your age or
          nationality—without exposing your personal data to anyone.
        </p>

        <p className="mt-4 text-sm text-muted-foreground">
          Powered by zero-knowledge cryptography. 100% open source.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://app.zentity.xyz/sign-up?fresh=1"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="w-full sm:w-auto text-base px-8">
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
              className="w-full sm:w-auto text-base px-8"
            >
              <IconBrandGithub className="size-5 mr-2" />
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
              className="w-full sm:w-auto text-base"
            >
              Read Docs
              <IconExternalLink className="size-4 ml-2" />
            </Button>
          </a>
        </div>

        {/* Trust Signal */}
        <div className="mt-16 flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Built with privacy-preserving cryptography
          </p>
          <div className="flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <div className="p-1.5 rounded-md bg-purple-500/10 border border-purple-500/20">
                <IconShield className="size-4 text-purple-400" />
              </div>
              <span className="text-muted-foreground">
                Zero-Knowledge Proofs
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="p-1.5 rounded-md bg-blue-500/10 border border-blue-500/20">
                <IconLock className="size-4 text-blue-400" />
              </div>
              <span className="text-muted-foreground">
                Homomorphic Encryption
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="p-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
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

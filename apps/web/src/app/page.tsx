import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Logo />
            <Badge variant="secondary">Alpha</Badge>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/sign-up">
              <Button>Get Started</Button>
            </Link>
            <ModeToggle />
          </div>
        </nav>
      </header>

      <main
        className="flex flex-1 flex-col items-center px-4 py-16 sm:py-24"
        id="main-content"
      >
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-bold text-4xl tracking-tight sm:text-6xl">
            Privacy-First
            <br />
            Identity Verification
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-8">
            Prove who you are without revealing your personal data. Zentity uses
            passkey-based authentication and key custody, zero-knowledge proofs,
            fully homomorphic encryption, and cryptographic commitments to
            verify your identity while keeping your information private.
          </p>

          <Alert className="mt-8 text-left" variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Proof of Concept</AlertTitle>
            <AlertDescription>
              Zentity is under active development. Our cryptographic approach is
              being validated. Use for evaluation only.
            </AlertDescription>
          </Alert>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/sign-up">
              <Button className="w-full sm:w-auto" size="lg">
                Start Verification
              </Button>
            </Link>
            <a
              href="https://zentity.xyz"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Button className="w-full sm:w-auto" size="lg" variant="outline">
                Learn More
              </Button>
            </a>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-border border-t py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-muted-foreground text-sm">
          <p>
            Your data is encrypted end-to-end. We never see or store your
            personal information in plain text.
          </p>
          <p className="mt-2">
            <Link
              className="text-muted-foreground/70 hover:text-muted-foreground"
              href="/api/build-info"
            >
              Verify build attestation
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

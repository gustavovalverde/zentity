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
            <Link href="/sign-up?fresh=1">
              <Button>Get Started</Button>
            </Link>
            <ModeToggle />
          </div>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-bold text-4xl tracking-tight sm:text-6xl">
            Privacy-First
            <br />
            Identity Verification
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-8">
            Prove who you are without revealing your personal data. Zentity uses
            zero-knowledge proofs and homomorphic encryption to verify your
            identity while keeping your information private.
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
            <Link href="/sign-up?fresh=1">
              <Button className="w-full sm:w-auto" size="lg">
                Start Verification
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button className="w-full sm:w-auto" size="lg" variant="outline">
                How It Works
              </Button>
            </Link>
          </div>
        </div>

        <section
          className="mx-auto mt-20 w-full max-w-5xl scroll-mt-24"
          id="how-it-works"
        >
          <h2 className="text-center font-bold text-3xl">How It Works</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                1
              </div>
              <h3 className="font-semibold text-lg">Start with Email</h3>
              <p className="mt-2 text-muted-foreground text-sm">
                Begin in seconds. We only ask for what we need, when we need it.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                2
              </div>
              <h3 className="font-semibold text-lg">Scan Your ID</h3>
              <p className="mt-2 text-muted-foreground text-sm">
                Upload a clear photo of your ID so we can extract the minimum
                fields required for verification.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                3
              </div>
              <h3 className="font-semibold text-lg">Verify Privately</h3>
              <p className="mt-2 text-muted-foreground text-sm">
                Prove claims (like being 18+) with cryptography so services can
                verify without seeing raw personal data.
              </p>
            </div>
          </div>
        </section>
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

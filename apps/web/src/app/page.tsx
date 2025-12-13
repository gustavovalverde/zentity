import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">Zentity</span>
            <Badge variant="secondary">Beta</Badge>
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

      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Privacy-First
            <br />
            Identity Verification
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            Prove who you are without revealing your personal data. Zentity uses
            zero-knowledge proofs and homomorphic encryption to verify your
            identity while keeping your information private.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/sign-up">
              <Button size="lg" className="w-full sm:w-auto">
                Start Verification
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                How It Works
              </Button>
            </Link>
          </div>
        </div>

        <section id="how-it-works" className="mx-auto mt-32 max-w-5xl px-4">
          <h2 className="text-center text-3xl font-bold">How It Works</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                1
              </div>
              <h3 className="text-lg font-semibold">Enter Your Details</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Provide your date of birth. Your data is encrypted immediately
                on your device.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                2
              </div>
              <h3 className="text-lg font-semibold">Generate Proof</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                We create a cryptographic proof that you meet the requirements
                without revealing your actual data.
              </p>
            </div>
            <div className="rounded-lg border border-border p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                3
              </div>
              <h3 className="text-lg font-semibold">Verify Instantly</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Services can verify your proof without ever seeing your personal
                information.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          Your data is encrypted end-to-end. We never see or store your personal
          information in plain text.
        </div>
      </footer>
    </div>
  );
}

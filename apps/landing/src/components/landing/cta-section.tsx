import {
  IconBrandGithub,
  IconCheck,
  IconExternalLink,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const trustPoints = [
  {
    title: "Verify our claims",
    description: "Don't trust us—read the code. Every operation is auditable.",
  },
  {
    title: "No vendor lock-in",
    description:
      "Self-host with Docker Compose. Your infrastructure, your control.",
  },
  {
    title: "Community-driven",
    description: "Report issues, suggest features, build privacy together.",
  },
];

export function CTASection() {
  return (
    <section className="py-24 px-4 md:px-6">
      <div className="mx-auto max-w-4xl">
        {/* Open Source Badge + Headline */}
        <div className="text-center">
          <Badge variant="outline" className="mb-4">
            MIT License
          </Badge>
          <h2 className="text-3xl font-bold sm:text-4xl">
            100% open source.
            <br />
            <span className="text-muted-foreground">Zero lock-in.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Every line of code is public. Audit every cryptographic operation.
            Self-host on your own infrastructure.
          </p>
        </div>

        {/* Trust Points */}
        <div className="mt-10 grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {trustPoints.map((point) => (
            <div key={point.title} className="flex items-start gap-3">
              <IconCheck className="size-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{point.title}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {point.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Cards */}
        <div className="mt-12 grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {/* Try Demo */}
          <a
            href="https://app.zentity.xyz/sign-up?fresh=1"
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <div className="rounded-xl border border-border bg-card p-6 hover:border-purple-500/50 transition-colors h-full flex flex-col">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10 border border-purple-500/20 mb-4 group-hover:bg-purple-500/20 transition-colors">
                <IconPlayerPlay className="size-6 text-purple-400" />
              </div>
              <h3 className="font-semibold mb-2">Try the Demo</h3>
              <p className="text-sm text-muted-foreground flex-grow">
                Full verification flow in 60 seconds.
              </p>
              <Button className="mt-4 w-full">Launch Demo</Button>
            </div>
          </a>

          {/* Star on GitHub */}
          <a
            href="https://github.com/gustavovalverde/zentity"
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <div className="rounded-xl border border-border bg-card p-6 hover:border-blue-500/50 transition-colors h-full flex flex-col">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 mb-4 group-hover:bg-blue-500/20 transition-colors">
                <IconBrandGithub className="size-6 text-blue-400" />
              </div>
              <h3 className="font-semibold mb-2">View Source</h3>
              <p className="text-sm text-muted-foreground flex-grow">
                Star the repo, fork it, or deploy your own.
              </p>
              <Button variant="outline" className="mt-4 w-full">
                GitHub
              </Button>
            </div>
          </a>

          {/* Read the Docs */}
          <a
            href="https://github.com/gustavovalverde/zentity/tree/main/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="group"
          >
            <div className="rounded-xl border border-border bg-card p-6 hover:border-emerald-500/50 transition-colors h-full flex flex-col">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-4 group-hover:bg-emerald-500/20 transition-colors">
                <IconExternalLink className="size-6 text-emerald-400" />
              </div>
              <h3 className="font-semibold mb-2">Read the Docs</h3>
              <p className="text-sm text-muted-foreground flex-grow">
                Understand the architecture in depth.
              </p>
              <Button variant="outline" className="mt-4 w-full">
                Documentation
              </Button>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
}

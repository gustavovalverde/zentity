import { IconPlayerPlay } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export function MidPageCTA() {
  return (
    <section className="py-16 px-4 md:px-6">
      <div className="mx-auto max-w-4xl text-center">
        <div className="rounded-2xl border border-border bg-card/50 p-8 md:p-12">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Ready to see it in action?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Experience the full verification flow in under 60 seconds.
          </p>
          <div className="mt-6">
            <a
              href="https://app.zentity.xyz/sign-up?fresh=1"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" className="px-8">
                <IconPlayerPlay className="size-5 mr-2" />
                Try Live Demo
              </Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";

import { ScenarioFlow } from "@/components/demo/scenario-flow";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { getScenario } from "@/lib/scenarios";

export default function BankOnboardingPage() {
  const scenario = getScenario("bank");
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0e7ff_0%,#f8fafc_45%,#f1f5f9_100%)] px-6 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            ← Back
          </Link>
        </div>
        <ScenarioFlow scenario={scenario} />
      </div>
    </div>
  );
}

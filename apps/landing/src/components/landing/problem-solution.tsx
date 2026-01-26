import {
  IconAntenna,
  IconCheck,
  IconCurrencyBitcoin,
  IconHeartHandshake,
  IconX,
} from "@tabler/icons-react";

import { ColoredIconBox } from "@/components/ui/colored-icon-box";
import type { SemanticColor } from "@/lib/colors";

const breaches: Array<{
  icon: typeof IconHeartHandshake;
  color: SemanticColor;
  name: string;
  impact: string;
  detail: string;
}> = [
  {
    icon: IconHeartHandshake,
    color: "red",
    name: "ICRC 2022",
    impact: "515,000 refugees",
    detail: "Identities and locations exposed",
  },
  {
    icon: IconCurrencyBitcoin,
    color: "orange",
    name: "Coinbase 2025",
    impact: "69,461 gov IDs",
    detail: "Stolen via employee bribery",
  },
  {
    icon: IconAntenna,
    color: "blue",
    name: "Optus 2022",
    impact: "10M Australians",
    detail: "Plain text, unauthenticated API",
  },
];

const categories = [
  {
    label: "PII STORAGE",
    problem: "Creates targets for attackers",
    solution: "Stores passkey-vault profile + hashed commitments",
  },
  {
    label: "IMAGES",
    problem: "Keeps document scans & selfies forever",
    solution: "Images processed in memory, then discarded",
  },
  {
    label: "BIOMETRICS",
    problem: "Retains sensitive face templates",
    solution: "Face embeddings never persisted",
  },
  {
    label: "AUDITABILITY",
    problem: "Opaque checks, no verifiable trail",
    solution: "Verifiable proof bundles + consent receipts",
  },
];

export function ProblemSolution() {
  return (
    <section className="px-4 py-24 md:px-6" id="problem">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-12 text-center">
          <h2 className="font-bold text-3xl sm:text-4xl">
            The problem is structural
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Each of these breaches should have changed everything. None of them
            did.
          </p>
        </div>

        {/* Breach Stats */}
        <div className="mb-12 grid gap-4 md:grid-cols-3">
          {breaches.map((breach) => (
            <div
              key={breach.name}
              className="flex flex-col items-center rounded-xl border border-border bg-card/50 p-5 text-center"
            >
              <ColoredIconBox
                icon={breach.icon}
                color={breach.color}
                size="lg"
                className="mb-3"
              />
              <div className="font-medium text-muted-foreground text-xs tracking-widest uppercase">
                {breach.name}
              </div>
              <div className="mt-1 font-bold text-foreground text-xl">
                {breach.impact}
              </div>
              <div className="mt-1 text-muted-foreground text-sm">
                {breach.detail}
              </div>
            </div>
          ))}
        </div>

        {/* Comparison Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Traditional - Problems */}
          <div className="rounded-xl border border-border bg-card/50 p-6 lg:p-8">
            <div className="mb-6 flex items-center gap-3">
              <ColoredIconBox icon={IconX} color="red" size="md" />
              <h3 className="font-semibold text-foreground text-lg">
                Traditional Identity
              </h3>
            </div>
            <div className="space-y-5">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="mb-0.5 font-medium text-muted-foreground text-xs tracking-widest uppercase">
                    {cat.label}
                  </div>
                  <div className="text-foreground">{cat.problem}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Zentity - Solutions */}
          <div className="rounded-xl border border-border bg-card/50 p-6 lg:p-8">
            <div className="mb-6 flex items-center gap-3">
              <ColoredIconBox icon={IconCheck} color="emerald" size="md" />
              <h3 className="font-semibold text-foreground text-lg">
                Zentity Approach
              </h3>
            </div>
            <div className="space-y-5">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="mb-0.5 font-medium text-muted-foreground text-xs tracking-widest uppercase">
                    {cat.label}
                  </div>
                  <div className="text-foreground">{cat.solution}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Statement */}
        <div className="mt-12 text-center">
          <p className="font-medium text-lg">
            Breaches expose only{" "}
            <span className="text-emerald-600">
              encrypted data, hashes, and proofs
            </span>
            —not readable documents or plaintext PII.
          </p>
          <p className="mt-3 text-muted-foreground text-sm">
            Zentity plugs into existing auth systems; it does not replace your
            IdP.
          </p>
        </div>
      </div>
    </section>
  );
}

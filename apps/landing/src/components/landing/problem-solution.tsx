import { IconCheck, IconX } from "@tabler/icons-react";

const categories = [
  {
    label: "PII STORAGE",
    problem: "Stores full names, addresses, birthdays",
    solution: "Stores hashed commitments + encrypted data",
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
    solution: "Verifiable proof bundles",
  },
];

export function ProblemSolution() {
  return (
    <section className="py-24 px-4 md:px-6" id="problem">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Traditional KYC is a privacy disaster
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Every data breach exposes millions of identities. We built something
            different.
          </p>
        </div>

        {/* Comparison Cards */}
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          {/* Traditional - Problems */}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-8">
              <IconX className="size-5 text-destructive" />
              <h3 className="text-xl font-semibold text-destructive">
                Traditional Identity
              </h3>
            </div>
            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="text-sm font-medium tracking-wider text-muted-foreground mb-1">
                    {cat.label}
                  </div>
                  <div className="text-foreground font-medium">
                    {cat.problem}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Zentity - Solutions */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-8">
              <IconCheck className="size-5 text-emerald-400" />
              <h3 className="text-xl font-semibold text-emerald-400">
                Zentity Approach
              </h3>
            </div>
            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="text-sm font-medium tracking-wider text-muted-foreground mb-1">
                    {cat.label}
                  </div>
                  <div className="text-foreground font-medium">
                    {cat.solution}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Statement */}
        <div className="mt-12 text-center">
          <p className="text-lg font-medium">
            Breaches expose only{" "}
            <span className="text-emerald-400">encrypted data and proofs</span>
            —not readable documents or personal data.
          </p>
        </div>
      </div>
    </section>
  );
}

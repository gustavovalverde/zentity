import { IconCheck, IconX } from "@tabler/icons-react";

const categories = [
  {
    label: "PII STORAGE",
    problem: "Stores full names, addresses, birthdays",
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
        <div className="mb-16 text-center">
          <h2 className="font-bold text-3xl sm:text-4xl">
            Traditional KYC is a privacy disaster
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Every data breach exposes millions of identities. We built something
            different.
          </p>
        </div>

        {/* Comparison Cards */}
        <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
          {/* Traditional - Problems */}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 lg:p-8">
            <div className="mb-8 flex items-center gap-2">
              <IconX className="size-5 text-destructive" />
              <h3 className="font-semibold text-destructive text-xl">
                Traditional Identity
              </h3>
            </div>
            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="mb-1 font-medium text-muted-foreground text-sm tracking-wider">
                    {cat.label}
                  </div>
                  <div className="font-medium text-foreground">
                    {cat.problem}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Zentity - Solutions */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 lg:p-8">
            <div className="mb-8 flex items-center gap-2">
              <IconCheck className="size-5 text-emerald-400" />
              <h3 className="font-semibold text-emerald-600 text-xl">
                Zentity Approach
              </h3>
            </div>
            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat.label}>
                  <div className="mb-1 font-medium text-muted-foreground text-sm tracking-wider">
                    {cat.label}
                  </div>
                  <div className="font-medium text-foreground">
                    {cat.solution}
                  </div>
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

import {
  IconAlertTriangle,
  IconCode,
  IconFlask,
  IconShieldCheck,
} from "@tabler/icons-react";

const disclaimerPoints = [
  {
    icon: IconCode,
    text: "Breaking changes expected - backward compatibility is not a goal",
  },
  {
    icon: IconFlask,
    text: "Cryptographic approach under active validation",
  },
  {
    icon: IconShieldCheck,
    text: "Best-effort security - not production-ready for sensitive data",
  },
];

export function PocDisclaimer() {
  return (
    <section className="px-4 pb-16 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 md:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5">
              <IconAlertTriangle className="size-6 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-lg">
                Active Development Notice
              </h3>
              <p className="mt-1 text-muted-foreground">
                Zentity is a proof of concept demonstrating that
                privacy-preserving compliance/KYC is technically feasible. We're
                actively validating our cryptographic approach across ZK proofs,
                FHE, and commitment schemes.
              </p>
            </div>
          </div>

          <div className="ml-14 space-y-3">
            {disclaimerPoints.map((point) => (
              <div key={point.text} className="flex items-center gap-3 text-sm">
                <point.icon className="size-4 shrink-0 text-amber-400" />
                <span className="text-muted-foreground">{point.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 ml-14 border-amber-500/20 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              This project serves as a reference architecture. For production
              deployments, conduct independent security audits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

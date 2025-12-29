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
    <section className="pb-16 px-4 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 md:p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <IconAlertTriangle className="size-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Active Development Notice
              </h3>
              <p className="text-muted-foreground mt-1">
                Zentity is a proof of concept demonstrating that
                privacy-preserving compliance/KYC is technically feasible. We're
                actively validating our cryptographic approach across ZK proofs,
                FHE, and commitment schemes.
              </p>
            </div>
          </div>

          <div className="space-y-3 ml-14">
            {disclaimerPoints.map((point) => (
              <div key={point.text} className="flex items-center gap-3 text-sm">
                <point.icon className="size-4 text-amber-400 shrink-0" />
                <span className="text-muted-foreground">{point.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-amber-500/20 ml-14">
            <p className="text-xs text-muted-foreground">
              This project serves as a reference architecture. For production
              deployments, conduct independent security audits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

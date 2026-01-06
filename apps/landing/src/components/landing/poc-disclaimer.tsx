import {
  IconAlertTriangle,
  IconCode,
  IconFlask,
  IconShieldCheck,
} from "@tabler/icons-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { colorStyles } from "@/lib/colors";
import { cn } from "@/lib/utils";

const disclaimerPoints = [
  {
    icon: IconCode,
    text: "Breaking changes expected - backward compatibility is not a goal",
  },
  {
    icon: IconFlask,
    text: "Cryptographic approach (passkeys, ZK proofs, FHE, commitments) under active validation",
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
        <Alert variant="warning" className="rounded-2xl p-6 md:p-8">
          <IconAlertTriangle className="size-6" />
          <AlertTitle className="font-semibold text-lg">
            Active Development Notice
          </AlertTitle>
          <AlertDescription className="mt-1">
            <p>
              Zentity is a proof of concept demonstrating that
              privacy-preserving compliance/KYC is technically feasible. We're
              actively validating our cryptographic approach across passkeys, ZK
              proofs, FHE, and commitment schemes.
            </p>

            <ul className="mt-4 space-y-3">
              {disclaimerPoints.map((point) => (
                <li
                  key={point.text}
                  className="flex items-center gap-3 text-sm"
                >
                  <point.icon
                    className={cn(
                      "size-4 shrink-0",
                      colorStyles.amber.iconText,
                    )}
                  />
                  <span>{point.text}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 border-amber-500/20 border-t pt-4">
              <p className="text-xs">
                This project serves as a reference architecture. For production
                deployments, conduct independent security audits.
              </p>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </section>
  );
}

import {
  LockKeyhole,
  type LucideIcon,
  ScanSearch,
  SmartphoneNfc,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface VerificationJourneyCardProps {
  method: "nfc_chip" | "ocr";
}

interface JourneyStep {
  description: string;
  icon: LucideIcon;
  title: string;
}

const METHOD_STEPS: Record<
  VerificationJourneyCardProps["method"],
  JourneyStep
> = {
  ocr: {
    title: "Scan your document and complete liveness",
    description:
      "Upload your ID, then confirm you're the holder with a selfie and gesture check.",
    icon: ScanSearch,
  },
  nfc_chip: {
    title: "Read your document's NFC chip",
    description:
      "Use your phone to read the chip and prove the document is genuine.",
    icon: SmartphoneNfc,
  },
};

const SHARED_STEPS: JourneyStep[] = [
  {
    title: "Generate privacy proofs",
    description:
      "We create the same verification proofs for your account after the document checks finish.",
    icon: ScanSearch,
  },
  {
    title: "Secure your identity data",
    description:
      "Verified identity data is sealed into your encrypted vault and FHE-backed records.",
    icon: LockKeyhole,
  },
];

export function VerificationJourneyCard({
  method,
}: Readonly<VerificationJourneyCardProps>) {
  const steps = [METHOD_STEPS[method], ...SHARED_STEPS];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>What Happens Next</CardTitle>
        <CardDescription>
          The capture method changes, but both verification paths finish the
          same way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li className="flex items-start gap-3" key={step.title}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium text-sm">{step.title}</p>
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {step.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

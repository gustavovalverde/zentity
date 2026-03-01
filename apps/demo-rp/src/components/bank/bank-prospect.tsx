import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PRODUCTS } from "@/data/bank";

interface BankProspectProps {
  onApply: () => void;
}

export function BankProspect({ onApply }: BankProspectProps) {
  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-start gap-3">
          <HugeiconsIcon
            className="mt-0.5 text-primary"
            icon={Shield01Icon}
            size={20}
          />
          <div>
            <p className="font-medium text-foreground">
              Complete verification to activate your account
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              Apply for any product below to start identity verification via
              Zentity. Your documents never leave your control.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {PRODUCTS.map((product) => (
          <Card
            className="group transition-all hover:border-primary/30 hover:shadow-lg"
            key={product.id}
          >
            <CardContent className="flex h-full flex-col pt-6">
              <h3 className="font-semibold text-lg tracking-tight">
                {product.name}
              </h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {product.description}
              </p>
              <ul className="mt-4 flex-1 space-y-2">
                {product.features.map((feature) => (
                  <li
                    className="flex items-center gap-2 text-muted-foreground text-sm"
                    key={feature}
                  >
                    <span className="size-1.5 rounded-full bg-primary/60" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6 w-full"
                onClick={onApply}
                variant="outline"
              >
                {product.cta}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

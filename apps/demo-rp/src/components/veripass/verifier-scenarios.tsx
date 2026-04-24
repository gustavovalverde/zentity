"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { VpRequest } from "@/components/shared/vp-request";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVpFlow } from "@/hooks/use-vp-flow";
import { getMissingVeripassClaims } from "@/lib/veripass-claims";
import { VERIFIER_SCENARIOS } from "@/scenarios/veripass/verifier-registry";
import type { VerifierScenario } from "@/scenarios/veripass/verifier-scenario";

interface VerifierScenariosProps {
  onSelect: (scenario: VerifierScenario) => void;
  presentableKeys: string[];
}

export function VerifierScenarios({
  onSelect,
  presentableKeys,
}: VerifierScenariosProps) {
  const vpFlow = useVpFlow();
  const [selectedScenario, setSelectedScenario] = useState<string>("Verifier");

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wider">
        Present to a Verifier
      </h3>

      {vpFlow.state === "idle" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {VERIFIER_SCENARIOS.map((scenario) => {
            const missingClaims = getMissingVeripassClaims(
              scenario.requiredClaims,
              presentableKeys
            );
            const canPresentLocally = missingClaims.length === 0;

            return (
              <Card
                className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-md"
                key={scenario.id}
              >
                <CardContent className="space-y-3 p-4">
                  <button
                    className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!canPresentLocally}
                    onClick={() => onSelect(scenario)}
                    type="button"
                  >
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <HugeiconsIcon icon={scenario.icon} size={20} />
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        {scenario.name}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {scenario.description}
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-1">
                    {scenario.requiredClaims.map((claim) => (
                      <Badge
                        className="px-1.5 py-0 text-[10px]"
                        key={claim}
                        variant="secondary"
                      >
                        {claim.replace(/_/g, " ")}
                      </Badge>
                    ))}
                    {scenario.optionalClaims.length > 0 && (
                      <Badge
                        className="px-1.5 py-0 text-[10px] text-muted-foreground"
                        variant="outline"
                      >
                        +{scenario.optionalClaims.length} optional
                      </Badge>
                    )}
                  </div>
                  {!canPresentLocally && (
                    <p className="text-muted-foreground text-xs">
                      This wallet credential is missing{" "}
                      {missingClaims
                        .map((claim) => claim.replace(/_/g, " "))
                        .join(", ")}
                      .
                    </p>
                  )}
                  <Button
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedScenario(scenario.name);
                      vpFlow.createSession(scenario.id);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Verify via OID4VP
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <VpRequest flow={vpFlow} scenarioName={selectedScenario} />
        </div>
      )}
    </div>
  );
}

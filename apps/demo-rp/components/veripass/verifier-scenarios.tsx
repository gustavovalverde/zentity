import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { VerifierScenario } from "@/data/veripass";
import { VERIFIER_SCENARIOS } from "@/data/veripass";

type VerifierScenariosProps = {
	onSelect: (scenario: VerifierScenario) => void;
};

export function VerifierScenarios({ onSelect }: VerifierScenariosProps) {
	return (
		<div className="space-y-3">
			<h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
				Present to a Verifier
			</h3>
			<div className="grid gap-3 sm:grid-cols-2">
				{VERIFIER_SCENARIOS.map((scenario) => (
					<Card
						key={scenario.id}
						className="cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
						onClick={() => onSelect(scenario)}
					>
						<CardContent className="p-4 space-y-3">
							<div className="flex items-center gap-3">
								<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
									<HugeiconsIcon icon={scenario.icon} size={20} />
								</div>
								<div>
									<div className="font-semibold text-sm">{scenario.name}</div>
									<div className="text-xs text-muted-foreground">
										{scenario.description}
									</div>
								</div>
							</div>
							<div className="flex flex-wrap gap-1">
								{scenario.requiredClaims.map((claim) => (
									<Badge
										key={claim}
										variant="secondary"
										className="text-[10px] px-1.5 py-0"
									>
										{claim.replace(/_/g, " ")}
									</Badge>
								))}
								{scenario.optionalClaims.length > 0 && (
									<Badge
										variant="outline"
										className="text-[10px] px-1.5 py-0 text-muted-foreground"
									>
										+{scenario.optionalClaims.length} optional
									</Badge>
								)}
							</div>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

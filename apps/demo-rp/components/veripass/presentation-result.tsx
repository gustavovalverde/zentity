import { CheckmarkCircle02Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CLAIM_LABELS } from "@/data/veripass";
import type { VerifierScenario } from "@/data/veripass";

type PresentationResultProps = {
	verifier: VerifierScenario;
	disclosedClaims: Record<string, unknown>;
	totalClaims: number;
	onBack: () => void;
};

export function PresentationResult({
	verifier,
	disclosedClaims,
	totalClaims,
	onBack,
}: PresentationResultProps) {
	const disclosedCount = Object.keys(disclosedClaims).length;
	const privacyPercent = Math.round(
		((totalClaims - disclosedCount) / totalClaims) * 100,
	);

	return (
		<div className="space-y-6">
			<Card className="border-success/30 bg-success/5">
				<CardContent className="p-6 space-y-4">
					<div className="flex items-center gap-3">
						<div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
							<HugeiconsIcon icon={CheckmarkCircle02Icon} size={28} />
						</div>
						<div>
							<h3 className="font-bold text-lg">Verification Successful</h3>
							<p className="text-sm text-muted-foreground">
								{verifier.name} received {disclosedCount} of {totalClaims}{" "}
								claims
							</p>
						</div>
					</div>

					{/* Privacy meter */}
					<div className="space-y-2">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Privacy preserved</span>
							<span className="font-bold text-success">{privacyPercent}%</span>
						</div>
						<div className="h-2 rounded-full bg-muted overflow-hidden">
							<div
								className="h-full rounded-full bg-success transition-all duration-500"
								style={{ width: `${privacyPercent}%` }}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Disclosed claims */}
			<div className="space-y-2">
				<h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
					<HugeiconsIcon icon={Shield01Icon} size={14} />
					Shared with {verifier.name}
				</h4>
				<div className="space-y-1">
					{Object.entries(disclosedClaims).map(([key, value]) => (
						<div
							key={key}
							className="flex items-center justify-between rounded-lg border p-3"
						>
							<span className="text-sm font-medium">
								{CLAIM_LABELS[key] || key}
							</span>
							<Badge
								variant="secondary"
								className="font-mono text-xs max-w-[200px] truncate"
							>
								{formatValue(value)}
							</Badge>
						</div>
					))}
				</div>
			</div>

			<Button onClick={onBack} className="w-full">
				Back to Wallet
			</Button>
		</div>
	);
}

function formatValue(value: unknown): string {
	if (value === true) return "Yes";
	if (value === false) return "No";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return JSON.stringify(value);
}

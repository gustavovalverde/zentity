import { Badge } from "@/components/ui/badge";
import { CLAIM_LABELS } from "@/data/veripass";

type ClaimListProps = {
	claims: Record<string, unknown>;
	presentableKeys: string[];
	selectedClaims: Set<string>;
	requiredClaims?: string[];
	onToggle: (key: string) => void;
};

export function ClaimList({
	claims,
	presentableKeys,
	selectedClaims,
	requiredClaims = [],
	onToggle,
}: ClaimListProps) {
	const requiredSet = new Set(requiredClaims);

	return (
		<div className="space-y-2">
			{presentableKeys.map((key) => {
				const isRequired = requiredSet.has(key);
				const isSelected = selectedClaims.has(key);
				const value = claims[key];

				return (
					<label
						key={key}
						className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
							isSelected
								? "bg-primary/5 border-primary/30"
								: "hover:bg-muted/50"
						} ${isRequired ? "ring-1 ring-primary/20" : ""}`}
					>
						<input
							type="checkbox"
							checked={isSelected}
							disabled={isRequired}
							onChange={() => onToggle(key)}
							className="size-4 rounded border-border accent-primary"
						/>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">
									{CLAIM_LABELS[key] || key}
								</span>
								{isRequired && (
									<Badge variant="outline" className="text-[10px] px-1.5 py-0">
										Required
									</Badge>
								)}
							</div>
							<div className="text-xs text-muted-foreground font-mono truncate">
								{formatClaimValue(value)}
							</div>
						</div>
					</label>
				);
			})}
		</div>
	);
}

function formatClaimValue(value: unknown): string {
	if (value === true) return "Yes";
	if (value === false) return "No";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return JSON.stringify(value);
}

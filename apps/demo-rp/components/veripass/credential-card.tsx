import { CheckmarkCircle02Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type CredentialCardProps = {
	issuer: string;
	claimCount: number;
	issuedAt: number;
};

export function CredentialCard({
	issuer,
	claimCount,
	issuedAt,
}: CredentialCardProps) {
	const issuerHost = (() => {
		try {
			return new URL(issuer).hostname;
		} catch {
			return issuer;
		}
	})();

	return (
		<Card className="overflow-hidden border-0 shadow-xl ring-1 ring-border">
			<div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-primary-foreground">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-2">
						<HugeiconsIcon icon={Shield01Icon} size={24} />
						<span className="font-bold text-lg">Zentity Identity</span>
					</div>
					<Badge className="bg-primary-foreground/20 text-primary-foreground border-0 text-xs">
						SD-JWT VC
					</Badge>
				</div>
				<div className="mt-6 space-y-1">
					<div className="text-sm text-primary-foreground/70">Issued by</div>
					<div className="font-mono text-sm">{issuerHost}</div>
				</div>
			</div>
			<div className="p-6 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div>
						<div className="text-xs text-muted-foreground">Claims</div>
						<div className="font-bold text-lg">{claimCount}</div>
					</div>
					<div className="h-8 w-px bg-border" />
					<div>
						<div className="text-xs text-muted-foreground">Issued</div>
						<div className="font-medium text-sm">
							{new Date(issuedAt).toLocaleDateString()}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-1.5 text-success text-sm">
					<HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
					<span className="font-medium">Valid</span>
				</div>
			</div>
		</Card>
	);
}

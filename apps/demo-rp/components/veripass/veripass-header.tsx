import { ArrowLeft01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type VeriPassHeaderProps = {
	hasCredential: boolean;
	userEmail?: string;
	onSignOut: () => void;
};

export function VeriPassHeader({
	hasCredential,
	userEmail,
	onSignOut,
}: VeriPassHeaderProps) {
	return (
		<header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50">
			<div className="container mx-auto flex items-center justify-between px-6 h-16">
				<div className="flex items-center gap-3">
					<Link
						href="/"
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						<HugeiconsIcon icon={ArrowLeft01Icon} size={18} />
					</Link>
					<div className="flex items-center gap-2">
						<HugeiconsIcon
							icon={Wallet01Icon}
							size={22}
							className="text-primary"
						/>
						<span className="font-bold text-lg tracking-tight">VeriPass</span>
					</div>
					{hasCredential && (
						<Badge
							variant="secondary"
							className="bg-success/15 text-success text-xs"
						>
							1 Credential
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-4">
					{userEmail && (
						<span className="text-sm text-muted-foreground hidden sm:block">
							{userEmail}
						</span>
					)}
					<Button variant="ghost" size="sm" onClick={onSignOut}>
						Sign Out
					</Button>
				</div>
			</div>
		</header>
	);
}

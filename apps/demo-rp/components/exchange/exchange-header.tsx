import { FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ExchangeHeaderProps = {
	activeSection: "portfolio" | "markets" | "trade";
	onSectionChange: (section: "portfolio" | "markets" | "trade") => void;
	isAuthenticated: boolean;
	isVerified: boolean;
	onConnect: () => void;
	onSignOut: () => void;
};

export function ExchangeHeader({
	activeSection,
	onSectionChange,
	isAuthenticated,
	isVerified,
	onConnect,
	onSignOut,
}: ExchangeHeaderProps) {
	const tabs = isAuthenticated
		? (["portfolio", "markets", "trade"] as const)
		: (["markets"] as const);

	return (
		<header className="border-b bg-card/50 backdrop-blur-md border-border sticky top-0 z-50">
			<div className="flex items-center justify-between px-6 py-3">
				<div className="flex items-center gap-8">
					<div className="flex items-center gap-2.5">
						<div className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.5)]">
							<HugeiconsIcon icon={FlashIcon} size={20} />
						</div>
						<span className="text-xl font-bold tracking-tighter uppercase font-mono">
							Nova<span className="text-primary">X</span>
						</span>
					</div>

					<nav className="flex bg-secondary/50 p-1 rounded-md border border-border/50">
						{tabs.map((section) => (
							<button
								key={section}
								type="button"
								onClick={() => onSectionChange(section)}
								className={`rounded px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
									activeSection === section
										? "bg-primary text-primary-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground hover:bg-secondary"
								}`}
							>
								{section}
							</button>
						))}
					</nav>
				</div>

				<div className="flex items-center gap-4">
					<div className="hidden md:flex items-center gap-2 text-[10px] bg-secondary/30 px-2 py-1 rounded border border-border/30">
						<span className="flex size-2 rounded-full bg-success animate-pulse" />
						<span className="text-success font-mono">SYSTEM OPERATIONAL</span>
					</div>

					{isVerified && (
						<Badge
							variant="outline"
							className="border-success/50 text-success bg-success/10 font-mono"
						>
							Lv.2 VERIFIED
						</Badge>
					)}

					<div className="flex items-center gap-2 pl-4 border-l border-border/50">
						{isAuthenticated ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={onSignOut}
								className="text-xs font-mono text-muted-foreground hover:text-destructive hover:bg-destructive/10"
							>
								DISCONNECT
							</Button>
						) : (
							<Button
								size="sm"
								onClick={onConnect}
								className="text-xs font-mono font-bold uppercase tracking-wider"
							>
								Connect with Zentity
							</Button>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}

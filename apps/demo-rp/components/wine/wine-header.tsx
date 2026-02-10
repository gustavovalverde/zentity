import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type WineHeaderProps = {
	activeTab: "browse" | "cart";
	onTabChange: (tab: "browse" | "cart") => void;
	cartCount: number;
	isVerified: boolean;
	isSignedIn: boolean;
	onSignOut: () => void;
};

function WineIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.118 3.118 0 01-2.22.92H9.69a3.118 3.118 0 01-2.22-.92L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5"
			/>
		</svg>
	);
}

export function WineHeader({
	activeTab,
	onTabChange,
	cartCount,
	isVerified,
	isSignedIn,
	onSignOut,
}: WineHeaderProps) {
	return (
		<header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
			<div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
				<div className="flex items-center gap-12">
					<div className="flex items-center gap-3 group cursor-pointer">
						<div className="p-2 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
							<WineIcon className="size-6 text-primary" />
						</div>
						<span className="font-serif text-2xl font-bold tracking-tight text-foreground">
							Vino Delivery
						</span>
					</div>
					<nav className="hidden md:flex gap-2">
						<button
							type="button"
							onClick={() => onTabChange("browse")}
							className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ${
								activeTab === "browse"
									? "bg-primary text-primary-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground hover:bg-muted"
							}`}
						>
							Collection
						</button>
						<button
							type="button"
							onClick={() => onTabChange("cart")}
							className={`relative rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ${
								activeTab === "cart"
									? "bg-primary text-primary-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground hover:bg-muted"
							}`}
						>
							Your Cellar
							{cartCount > 0 && (
								<span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground border-2 border-background animate-in zoom-in">
									{cartCount}
								</span>
							)}
						</button>
					</nav>
				</div>
				<div className="flex items-center gap-4">
					{isVerified && (
						<Badge
							variant="outline"
							className="border-success/30 text-success bg-success/5 px-3 py-1 font-sans tracking-wide"
						>
							Verified 21+
						</Badge>
					)}
					{isSignedIn && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onSignOut}
							className="font-sans text-muted-foreground hover:text-foreground"
						>
							Sign Out
						</Button>
					)}
				</div>
			</div>
		</header>
	);
}

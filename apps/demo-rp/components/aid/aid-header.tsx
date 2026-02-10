import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

interface AidHeaderProps {
	userEmail?: string | null;
	isVerified?: boolean;
	onSignOut: () => void;
}

export function AidHeader({
	userEmail,
	isVerified,
	onSignOut,
}: AidHeaderProps) {
	return (
		<header className="border-b bg-card relative z-10">
			<div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
						<HugeiconsIcon icon={Globe02Icon} size={24} />
					</div>
					<div>
						<span className="block font-bold text-lg tracking-tight text-foreground leading-none">
							Relief Global
						</span>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
							Humanitarian Aid
						</span>
					</div>
				</div>

				{userEmail && (
					<div className="flex items-center gap-4">
						<div className="hidden md:block text-right">
							<div className="text-sm font-medium">{userEmail}</div>
							<div className="text-[10px] uppercase tracking-wider text-success font-bold flex items-center justify-end gap-1">
								{isVerified && (
									<span className="size-1.5 rounded-full bg-success animate-pulse" />
								)}
								{isVerified ? "Verified Beneficiary" : "Unverified"}
							</div>
						</div>
						<button
							onClick={onSignOut}
							className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
						>
							Sign Out
						</button>
					</div>
				)}
			</div>
		</header>
	);
}

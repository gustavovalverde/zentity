"use client";

import { ArrowLeft01Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { Button } from "@/components/ui/button";

type WineAgeGateProps = {
	dcrConfig: { clientName: string; defaultScopes: string };
	providerId: string;
	onVerify: () => void;
};

function WineIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
			/>
		</svg>
	);
}

export function WineAgeGate({
	dcrConfig,
	providerId,
	onVerify,
}: WineAgeGateProps) {
	const [dcrReady, setDcrReady] = useState(false);
	const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

	return (
		<div
			data-theme="wine"
			className="min-h-screen bg-background text-foreground flex flex-col font-serif selection:bg-primary/30"
		>
			<header className="px-8 py-6 flex items-center justify-between border-b border-border">
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
						<WineIcon className="size-5" />
					</div>
					<div>
						<span className="text-xl tracking-wide font-medium">
							Vino Delivery
						</span>
						<span className="block text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
							Est. 1928
						</span>
					</div>
				</div>
				<Link
					href="/"
					className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-sm font-sans"
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
					Demos
				</Link>
			</header>

			<div className="flex-1 flex flex-col items-center justify-center px-6 relative overflow-hidden">
				<div className="absolute top-1/4 -right-32 size-[500px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
				<div className="absolute bottom-1/4 -left-32 size-[500px] bg-accent/5 rounded-full blur-3xl pointer-events-none" />

				<div className="w-full max-w-md space-y-10 text-center relative z-10">
					<div className="space-y-6">
						<div className="mx-auto size-20 rounded-full border border-primary/20 bg-primary/5 flex items-center justify-center">
							<span className="text-4xl font-bold text-primary">21+</span>
						</div>
						<h1 className="text-4xl md:text-5xl font-medium leading-tight">
							Age Verification
							<br />
							<span className="italic text-primary">Required</span>
						</h1>
						<p className="text-lg text-muted-foreground font-sans leading-relaxed max-w-sm mx-auto">
							You must be 21 or older to browse and purchase alcohol. Verify
							your age through Zentity — your exact birthdate is never shared.
						</p>
					</div>

					<div className="space-y-4 pt-2">
						<DcrRegistration
							providerId={providerId}
							clientName={dcrConfig.clientName}
							defaultScopes={dcrConfig.defaultScopes}
							onRegistered={handleDcrRegistered}
						/>
						<Button
							onClick={onVerify}
							disabled={!dcrReady}
							size="lg"
							className="w-full h-14 rounded-none bg-primary hover:bg-primary/90 text-primary-foreground text-lg uppercase tracking-widest font-medium transition-all disabled:opacity-40 gap-3"
						>
							<HugeiconsIcon icon={ShieldKeyIcon} size={20} />
							Verify Age with Zentity
						</Button>
						<p className="text-xs text-muted-foreground uppercase tracking-widest">
							Only a yes/no proof is shared — never your birthdate
						</p>
					</div>
				</div>
			</div>

			<footer className="py-6 border-t border-border text-center text-xs text-muted-foreground uppercase tracking-widest">
				Please drink responsibly
			</footer>
		</div>
	);
}

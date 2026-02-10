"use client";

import {
	ArrowLeft01Icon,
	Globe02Icon,
	SecurityCheckIcon,
	SecurityLockIcon,
	Shield01Icon,
	UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { AidDashboard } from "@/components/aid/aid-dashboard";
import { AidHeader } from "@/components/aid/aid-header";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { DebugPanel } from "@/components/shared/debug-panel";
import { Button } from "@/components/ui/button";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("aid");

export default function AidPage() {
	const {
		session,
		isPending,
		isAuthenticated,
		claims,
		isSteppedUp,
		handleSignIn,
		handleStepUp,
		handleSignOut,
	} = useOAuthFlow(scenario);

	const [dcrReady, setDcrReady] = useState(false);
	const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

	if (isPending) {
		return (
			<div
				data-theme="aid"
				className="flex min-h-screen items-center justify-center bg-background"
			>
				<div className="flex flex-col items-center gap-4">
					<div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<div className="text-muted-foreground font-medium">
						Verifying credentials...
					</div>
				</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return (
			<div
				data-theme="aid"
				className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary/10"
			>
				<AidHeader onSignOut={() => {}} />

				<div className="flex-1 flex flex-col items-center justify-center px-6 relative overflow-hidden">
					<div className="absolute top-6 right-6">
						<Link
							href="/"
							className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-sm"
						>
							<HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
							Demos
						</Link>
					</div>

					<div className="w-full max-w-md space-y-8 text-center relative z-10">
						<div className="mx-auto size-24 bg-card rounded-full shadow-xl shadow-primary/5 flex items-center justify-center mb-4">
							<HugeiconsIcon
								icon={Globe02Icon}
								size={48}
								className="text-primary"
							/>
						</div>

						<div className="space-y-4">
							<h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
								Aid Distribution Portal
							</h1>
							<p className="text-muted-foreground text-lg leading-relaxed">
								Securely verify your identity to access humanitarian assistance.
								We protect your privacy by minimizing data collection.
							</p>
						</div>

						<div className="space-y-6 pt-4">
							<DcrRegistration
								providerId={scenario.id}
								clientName={scenario.dcr.clientName}
								defaultScopes={scenario.dcr.defaultScopes}
								onRegistered={handleDcrRegistered}
							/>
							<Button
								onClick={handleSignIn}
								disabled={!dcrReady}
								size="lg"
								className="w-full h-14 text-lg font-medium shadow-lg hover:shadow-xl transition-all gap-3 bg-primary hover:bg-primary/90"
							>
								<HugeiconsIcon icon={UserCircle02Icon} size={20} />
								Verify Identity
							</Button>

							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
								{[
									{
										icon: SecurityCheckIcon,
										text: "Your biometric data is never stored",
									},
									{
										icon: SecurityLockIcon,
										text: "Only name & nationality shared",
									},
									{
										icon: Shield01Icon,
										text: "Cryptographic proofs, not trust",
									},
									{
										icon: Globe02Icon,
										text: "Works across borders",
									},
								].map((item) => (
									<div
										key={item.text}
										className="bg-card p-3 rounded-lg border shadow-sm flex items-center gap-2"
									>
										<HugeiconsIcon
											icon={item.icon}
											size={16}
											className="text-success shrink-0"
										/>
										<span>{item.text}</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div data-theme="aid" className="min-h-screen bg-background flex flex-col">
			<AidHeader
				userEmail={session?.user.email}
				isVerified={isSteppedUp}
				onSignOut={handleSignOut}
			/>

			<main className="flex-1 container mx-auto px-6 py-8">
				<div className="max-w-5xl mx-auto space-y-8">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">
							Beneficiary Dashboard
						</h1>
						<p className="text-muted-foreground">
							Manage your aid distribution and verify status.
						</p>
					</div>

					<AidDashboard
						isSteppedUp={isSteppedUp}
						claims={claims}
						onStepUp={handleStepUp}
					/>
				</div>
			</main>

			<DebugPanel
				claims={claims}
				session={session}
				notShared={scenario.notShared}
				isComplete={isSteppedUp}
			/>
		</div>
	);
}

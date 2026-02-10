"use client";

import {
	ArrowLeft01Icon,
	Shield01Icon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DcrRegistration } from "@/components/shared/dcr-registration";
import { DebugPanel } from "@/components/shared/debug-panel";
import { Button } from "@/components/ui/button";
import { ClaimList } from "@/components/veripass/claim-list";
import { CredentialCard } from "@/components/veripass/credential-card";
import { PresentationResult } from "@/components/veripass/presentation-result";
import { VerifierScenarios } from "@/components/veripass/verifier-scenarios";
import { VeriPassHeader } from "@/components/veripass/veripass-header";
import type { VerifierScenario } from "@/data/veripass";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";
import {
	clearCredential,
	createPresentation,
	decodeClaims,
	getPresentableKeys,
	loadCredential,
	type StoredCredential,
	saveCredential,
	verifyPresentation,
} from "@/lib/wallet";

const scenario = getScenario("veripass");

type WalletState =
	| { phase: "empty" }
	| { phase: "issuing" }
	| {
			phase: "wallet";
			stored: StoredCredential;
			claims: Record<string, unknown>;
			presentableKeys: string[];
	  }
	| {
			phase: "presenting";
			stored: StoredCredential;
			claims: Record<string, unknown>;
			presentableKeys: string[];
			verifier: VerifierScenario;
			selectedClaims: Set<string>;
	  }
	| {
			phase: "result";
			verifier: VerifierScenario;
			disclosedClaims: Record<string, unknown>;
			totalClaims: number;
	  };

export default function VeriPassPage() {
	const {
		session,
		isPending,
		isAuthenticated,
		claims: oauthClaims,
		handleSignIn,
		handleSignOut,
	} = useOAuthFlow(scenario);

	const [dcrReady, setDcrReady] = useState(false);
	const handleDcrRegistered = useCallback(() => setDcrReady(true), []);

	const [walletState, setWalletState] = useState<WalletState>({
		phase: "empty",
	});
	const [error, setError] = useState<string | null>(null);

	// Load stored credential on mount
	useEffect(() => {
		if (!isAuthenticated) return;
		const stored = loadCredential();
		if (!stored) {
			setWalletState({ phase: "empty" });
			return;
		}
		decodeClaims(stored.credential)
			.then(async (claims) => {
				const presentableKeys = await getPresentableKeys(stored.credential);
				setWalletState({ phase: "wallet", stored, claims, presentableKeys });
			})
			.catch(() => {
				clearCredential();
				setWalletState({ phase: "empty" });
			});
	}, [isAuthenticated]);

	const handleImportOffer = useCallback(async (offerUri: string) => {
		setWalletState({ phase: "issuing" });
		setError(null);
		try {
			const res = await fetch("/api/veripass/issue", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ offerUri }),
			});
			if (!res.ok) {
				const data = (await res.json()) as { error: string };
				throw new Error(data.error || `Issuance failed: ${res.status}`);
			}
			const { credential, issuer, holderPublicJwk, holderPrivateJwk } =
				(await res.json()) as {
					credential: string;
					issuer: string;
					holderPublicJwk: JsonWebKey;
					holderPrivateJwk: JsonWebKey;
				};

			const stored: StoredCredential = {
				credential,
				issuer,
				holderPublicJwk,
				holderPrivateJwk,
				createdAt: Date.now(),
			};
			saveCredential(stored);

			const claims = await decodeClaims(credential);
			const presentableKeys = await getPresentableKeys(credential);
			setWalletState({ phase: "wallet", stored, claims, presentableKeys });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Credential import failed");
			setWalletState({ phase: "empty" });
		}
	}, []);

	const handleSelectVerifier = useCallback(
		(verifier: VerifierScenario) => {
			if (walletState.phase !== "wallet") return;
			const { stored, claims, presentableKeys } = walletState;
			const selectedClaims = new Set(
				verifier.requiredClaims.filter((k) => presentableKeys.includes(k)),
			);
			setWalletState({
				phase: "presenting",
				stored,
				claims,
				presentableKeys,
				verifier,
				selectedClaims,
			});
		},
		[walletState],
	);

	const handleToggleClaim = useCallback(
		(key: string) => {
			if (walletState.phase !== "presenting") return;
			const next = new Set(walletState.selectedClaims);
			if (walletState.verifier.requiredClaims.includes(key)) return;
			if (next.has(key)) next.delete(key);
			else next.add(key);
			setWalletState({ ...walletState, selectedClaims: next });
		},
		[walletState],
	);

	const handlePresent = useCallback(async () => {
		if (walletState.phase !== "presenting") return;
		setError(null);
		try {
			const presentation = await createPresentation(
				walletState.stored.credential,
				[...walletState.selectedClaims],
			);
			const disclosedClaims = await verifyPresentation(presentation);
			const metaKeys = new Set([
				"iss",
				"sub",
				"aud",
				"exp",
				"iat",
				"nbf",
				"jti",
				"cnf",
				"vct",
				"status",
				"_sd_alg",
			]);
			const filtered: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(disclosedClaims)) {
				if (!metaKeys.has(k)) filtered[k] = v;
			}
			setWalletState({
				phase: "result",
				verifier: walletState.verifier,
				disclosedClaims: filtered,
				totalClaims: walletState.presentableKeys.length,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Presentation failed");
		}
	}, [walletState]);

	const handleBackToWallet = useCallback(() => {
		const stored = loadCredential();
		if (!stored) {
			setWalletState({ phase: "empty" });
			return;
		}
		decodeClaims(stored.credential)
			.then(async (claims) => {
				const presentableKeys = await getPresentableKeys(stored.credential);
				setWalletState({ phase: "wallet", stored, claims, presentableKeys });
			})
			.catch(() => setWalletState({ phase: "empty" }));
	}, []);

	const handleFullSignOut = useCallback(async () => {
		clearCredential();
		await handleSignOut();
	}, [handleSignOut]);

	if (isPending) {
		return (
			<div
				data-theme="veripass"
				className="flex min-h-screen items-center justify-center bg-background"
			>
				<div className="flex flex-col items-center gap-4">
					<div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<div className="text-muted-foreground font-medium">Loading...</div>
				</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return (
			<div
				data-theme="veripass"
				className="min-h-screen bg-background flex flex-col font-sans selection:bg-primary/10"
			>
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
								icon={Wallet01Icon}
								size={48}
								className="text-primary"
							/>
						</div>

						<div className="space-y-4">
							<h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
								Digital Credential Wallet
							</h1>
							<p className="text-muted-foreground text-lg leading-relaxed">
								Receive a verifiable credential from Zentity, then choose
								exactly which claims to share with each verifier. Your data,
								your rules.
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
								<HugeiconsIcon icon={Shield01Icon} size={20} />
								Connect with Zentity
							</Button>

							<div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
								{[
									"Receive credential",
									"Choose what to share",
									"Prove selectively",
								].map((step, i) => (
									<div
										key={step}
										className="bg-card p-3 rounded-lg border shadow-sm text-center"
									>
										<div className="font-bold text-primary mb-1">{i + 1}</div>
										{step}
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
		<div
			data-theme="veripass"
			className="min-h-screen bg-background flex flex-col"
		>
			<VeriPassHeader
				hasCredential={walletState.phase !== "empty"}
				userEmail={session?.user.email}
				onSignOut={handleFullSignOut}
			/>

			<main className="flex-1 container mx-auto px-6 py-8">
				<div className="max-w-2xl mx-auto space-y-8">
					{error && (
						<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
							{error}
						</div>
					)}

					{walletState.phase === "empty" && (
						<EmptyWallet onImport={handleImportOffer} />
					)}

					{walletState.phase === "issuing" && <IssuingState />}

					{walletState.phase === "wallet" && (
						<>
							<CredentialCard
								issuer={walletState.stored.issuer}
								claimCount={walletState.presentableKeys.length}
								issuedAt={walletState.stored.createdAt}
							/>
							<div className="space-y-2">
								<h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
									Credential Claims
								</h3>
								<ClaimList
									claims={walletState.claims}
									presentableKeys={walletState.presentableKeys}
									selectedClaims={new Set(walletState.presentableKeys)}
									onToggle={() => {}}
								/>
							</div>
							<VerifierScenarios onSelect={handleSelectVerifier} />
						</>
					)}

					{walletState.phase === "presenting" && (
						<PresentingState
							walletState={walletState}
							onToggle={handleToggleClaim}
							onPresent={handlePresent}
							onCancel={handleBackToWallet}
						/>
					)}

					{walletState.phase === "result" && (
						<PresentationResult
							verifier={walletState.verifier}
							disclosedClaims={walletState.disclosedClaims}
							totalClaims={walletState.totalClaims}
							onBack={handleBackToWallet}
						/>
					)}
				</div>
			</main>

			<DebugPanel
				claims={oauthClaims}
				session={session}
				notShared={scenario.notShared}
				isComplete={walletState.phase !== "empty"}
			/>
		</div>
	);
}

function EmptyWallet({ onImport }: { onImport: (offerUri: string) => void }) {
	const [offerUri, setOfferUri] = useState("");

	const handleSubmit = useCallback(() => {
		if (!offerUri.trim()) return;
		onImport(offerUri);
	}, [offerUri, onImport]);

	return (
		<div className="space-y-8 py-8">
			<div className="text-center space-y-4">
				<div className="mx-auto size-20 bg-muted rounded-full flex items-center justify-center">
					<HugeiconsIcon
						icon={Wallet01Icon}
						size={36}
						className="text-muted-foreground"
					/>
				</div>
				<div className="space-y-2">
					<h2 className="text-2xl font-bold">Your Wallet is Empty</h2>
					<p className="text-muted-foreground max-w-md mx-auto">
						To receive a verifiable credential, go to your{" "}
						<a
							href="http://localhost:3000/dashboard/credentials"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary underline underline-offset-2 hover:text-primary/80"
						>
							Zentity Dashboard &rarr; Credentials
						</a>{" "}
						and click <strong>Get Credential</strong>. Then paste the credential
						offer URI below.
					</p>
				</div>
			</div>

			<div className="max-w-lg mx-auto space-y-3">
				<label
					htmlFor="offer-uri"
					className="text-sm font-medium text-foreground"
				>
					Credential Offer
				</label>
				<textarea
					id="offer-uri"
					value={offerUri}
					onChange={(e) => setOfferUri(e.target.value)}
					placeholder="openid-credential-offer://?credential_offer=..."
					rows={3}
					className="w-full rounded-lg border bg-card px-4 py-3 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
				/>
				<Button
					onClick={handleSubmit}
					disabled={!offerUri.trim()}
					size="lg"
					className="w-full gap-2 shadow-lg hover:shadow-xl transition-all"
				>
					<HugeiconsIcon icon={Shield01Icon} size={18} />
					Import Credential
				</Button>
			</div>
		</div>
	);
}

function IssuingState() {
	return (
		<div className="text-center space-y-6 py-12">
			<div className="mx-auto size-20 bg-primary/10 rounded-full flex items-center justify-center">
				<div className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
			</div>
			<div className="space-y-2">
				<h2 className="text-2xl font-bold">Receiving Credential</h2>
				<p className="text-muted-foreground">
					Exchanging credential offer via OID4VCI...
				</p>
			</div>
		</div>
	);
}

function PresentingState({
	walletState,
	onToggle,
	onPresent,
	onCancel,
}: {
	walletState: Extract<WalletState, { phase: "presenting" }>;
	onToggle: (key: string) => void;
	onPresent: () => void;
	onCancel: () => void;
}) {
	const { verifier, claims, presentableKeys, selectedClaims } = walletState;
	const privacyPercent = Math.round(
		((presentableKeys.length - selectedClaims.size) / presentableKeys.length) *
			100,
	);

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h2 className="text-xl font-bold">Present to {verifier.name}</h2>
				<p className="text-sm text-muted-foreground">
					{verifier.description}. Select which claims to share.
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">Privacy level</span>
					<span className="font-bold">
						{selectedClaims.size} of {presentableKeys.length} claims shared
					</span>
				</div>
				<div className="h-2 rounded-full bg-muted overflow-hidden">
					<div
						className="h-full rounded-full bg-success transition-all duration-300"
						style={{ width: `${privacyPercent}%` }}
					/>
				</div>
			</div>

			<ClaimList
				claims={claims}
				presentableKeys={presentableKeys}
				selectedClaims={selectedClaims}
				requiredClaims={verifier.requiredClaims}
				onToggle={onToggle}
			/>

			<div className="flex gap-3">
				<Button variant="outline" onClick={onCancel} className="flex-1">
					Cancel
				</Button>
				<Button onClick={onPresent} className="flex-1">
					Present Credential
				</Button>
			</div>
		</div>
	);
}

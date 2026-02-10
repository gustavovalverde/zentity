"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

function OAuthStartInner() {
	const params = useSearchParams();
	const started = useRef(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (started.current) return;
		started.current = true;

		const providerId = params.get("providerId");
		const callbackURL = params.get("callbackURL") || "/";
		const scopes = params.get("scopes")?.split(" ").filter(Boolean);

		if (!providerId) {
			setError("Missing providerId parameter");
			return;
		}

		authClient.signIn
			.oauth2({
				providerId,
				callbackURL,
				...(scopes?.length ? { scopes } : {}),
			})
			.then((result) => {
				if (result.error) {
					setError(`${result.error.status}: ${result.error.message}`);
				}
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : String(err));
			});
	}, [params]);

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center p-8">
				<div className="max-w-md space-y-4 text-center">
					<p className="text-sm font-medium text-destructive">
						OAuth redirect failed
					</p>
					<pre className="rounded border bg-muted p-4 text-xs text-left whitespace-pre-wrap break-all">
						{error}
					</pre>
					<p className="text-xs text-muted-foreground">
						Check demo-rp terminal for details
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center">
			<p className="animate-pulse text-sm text-muted-foreground">
				Redirecting to Zentity...
			</p>
		</div>
	);
}

export default function OAuthStartPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center">
					<p className="animate-pulse text-sm text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<OAuthStartInner />
		</Suspense>
	);
}

"use client";

import { PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type DcrRegistrationProps = {
	providerId: string;
	clientName: string;
	defaultScopes: string;
	onRegistered: (clientId: string) => void;
};

type RegistrationState =
	| { status: "checking" }
	| { status: "idle" }
	| { status: "registering" }
	| { status: "done" };

export function DcrRegistration({
	providerId,
	clientName,
	defaultScopes,
	onRegistered,
}: DcrRegistrationProps) {
	const [state, setState] = useState<RegistrationState>({
		status: "checking",
	});
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch(`/api/dcr?providerId=${encodeURIComponent(providerId)}`)
			.then((r) => r.json())
			.then((data) => {
				if (cancelled) return;
				if (data.registered && data.client_id) {
					setState({ status: "done" });
					onRegistered(data.client_id);
				} else {
					setState({ status: "idle" });
				}
			})
			.catch(() => {
				if (!cancelled) setState({ status: "idle" });
			});
		return () => {
			cancelled = true;
		};
	}, [providerId, onRegistered]);

	const handleRegister = async () => {
		setState({ status: "registering" });
		setError(null);
		try {
			const res = await fetch("/api/dcr", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					providerId,
					clientName,
					scopes: defaultScopes,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Registration failed");
				setState({ status: "idle" });
				return;
			}
			setState({ status: "done" });
			onRegistered(data.client_id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Registration failed");
			setState({ status: "idle" });
		}
	};

	if (state.status === "checking") {
		return (
			<div className="animate-pulse text-sm text-muted-foreground">
				Checking registration...
			</div>
		);
	}

	if (state.status === "done") {
		return null;
	}

	return (
		<div className="space-y-3 rounded-lg border p-4">
			<div className="flex items-center gap-2">
				<HugeiconsIcon
					icon={PlusSignCircleIcon}
					size={16}
					className="text-primary"
				/>
				<span className="text-sm font-medium">Dynamic Client Registration</span>
			</div>
			<div className="space-y-1.5 text-sm text-muted-foreground">
				<div className="flex items-center gap-2">
					<span className="text-xs">Client name:</span>
					<span className="font-medium text-foreground">{clientName}</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs">Scopes:</span>
					<span className="font-mono text-xs">{defaultScopes}</span>
				</div>
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
			<Button
				onClick={handleRegister}
				disabled={state.status === "registering"}
				variant="outline"
				size="sm"
				className="w-full"
			>
				{state.status === "registering"
					? "Registering..."
					: "Register with Zentity"}
			</Button>
			<p className="text-xs text-muted-foreground">
				Uses RFC 7591 Dynamic Client Registration
			</p>
		</div>
	);
}

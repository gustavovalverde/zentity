"use client";

import { useState } from "react";
import { ClaimsDisplay } from "./claims-display";
import { PrivacyComparison } from "./privacy-comparison";

type DebugPanelProps = {
	claims?: Record<string, unknown>;
	session?: unknown;
	notShared?: string[];
	isComplete?: boolean;
};

export function DebugPanel({
	claims,
	session,
	notShared,
	isComplete,
}: DebugPanelProps) {
	const [open, setOpen] = useState(false);

	if (!session) return null;

	return (
		<div className="fixed right-4 bottom-4 z-50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg transition-colors hover:bg-foreground/90"
			>
				<svg
					className="size-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
					/>
				</svg>
				{open ? "Hide" : "Claims"}
			</button>

			{open && (
				<div className="absolute right-0 bottom-12 w-96 max-h-[70vh] overflow-y-auto rounded-xl border bg-card p-4 shadow-2xl">
					<div className="space-y-4">
						{claims && (
							<div>
								<h3 className="mb-2 text-sm font-semibold">Received Claims</h3>
								<ClaimsDisplay claims={claims} />
							</div>
						)}

						{isComplete && notShared && (
							<div>
								<h3 className="mb-2 text-sm font-semibold">
									What Stays Private
								</h3>
								<PrivacyComparison notShared={notShared} />
							</div>
						)}

						<details className="rounded-lg border">
							<summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
								Raw session data
							</summary>
							<pre className="overflow-x-auto border-t bg-muted p-3 text-xs text-muted-foreground">
								{JSON.stringify(session, null, 2)}
							</pre>
						</details>
					</div>
				</div>
			)}
		</div>
	);
}

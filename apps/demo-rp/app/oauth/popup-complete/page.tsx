"use client";

import { useEffect } from "react";

export default function OAuthPopupCompletePage() {
	useEffect(() => {
		if (globalThis.window.opener) {
			globalThis.window.opener.postMessage(
				{ type: "zentity:oauth:complete" },
				globalThis.window.location.origin,
			);
			globalThis.window.close();
		} else {
			globalThis.window.location.assign("/");
		}
	}, []);

	return (
		<div className="flex min-h-screen items-center justify-center">
			<p className="text-sm text-muted-foreground">
				Sign-in complete. This window will close automatically.
			</p>
		</div>
	);
}

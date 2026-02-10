const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 700;
const POLL_INTERVAL_MS = 500;

function isMobile(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent,
	);
}

/**
 * Open the OAuth flow in a centered popup window.
 * Returns true if the flow completed, false if blocked or closed early.
 */
export function openOAuthPopup(
	providerId: string,
	scopes?: string[],
): Promise<boolean> {
	if (isMobile()) {
		return Promise.resolve(false);
	}

	return new Promise((resolve) => {
		const left = Math.round(
			globalThis.window.screenX +
				(globalThis.window.outerWidth - POPUP_WIDTH) / 2,
		);
		const top = Math.round(
			globalThis.window.screenY +
				(globalThis.window.outerHeight - POPUP_HEIGHT) / 2,
		);

		const params = new URLSearchParams({
			providerId,
			callbackURL: "/oauth/popup-complete",
		});
		if (scopes?.length) {
			params.set("scopes", scopes.join(" "));
		}

		const popup = globalThis.window.open(
			`/oauth/start?${params.toString()}`,
			"zentity-oauth",
			`width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=yes`,
		);

		if (!popup || popup.closed) {
			resolve(false);
			return;
		}

		let resolved = false;

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== globalThis.window.location.origin) return;
			if (event.data?.type !== "zentity:oauth:complete") return;

			resolved = true;
			cleanup();
			resolve(true);
		};

		const pollTimer = setInterval(() => {
			if (popup.closed && !resolved) {
				resolved = true;
				cleanup();
				resolve(false);
			}
		}, POLL_INTERVAL_MS);

		const cleanup = () => {
			globalThis.window.removeEventListener("message", onMessage);
			clearInterval(pollTimer);
			if (!popup.closed) {
				popup.close();
			}
		};

		globalThis.window.addEventListener("message", onMessage);
	});
}

export { isMobile };

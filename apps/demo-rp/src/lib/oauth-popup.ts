const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 700;
const POLL_INTERVAL_MS = 500;
const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

function isMobile(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return MOBILE_UA_RE.test(navigator.userAgent);
}

export interface OAuthPopupResult {
  completed: boolean;
  error?: string;
  errorDescription?: string;
}

/**
 * Open the OAuth flow in a centered popup window.
 * Returns completion status and any OAuth error from the provider.
 */
export function openOAuthPopup(
  providerId: string,
  scopes?: string[]
): Promise<OAuthPopupResult> {
  if (isMobile()) {
    return Promise.resolve({ completed: false });
  }

  return new Promise((resolve) => {
    const left = Math.round(
      globalThis.window.screenX +
        (globalThis.window.outerWidth - POPUP_WIDTH) / 2
    );
    const top = Math.round(
      globalThis.window.screenY +
        (globalThis.window.outerHeight - POPUP_HEIGHT) / 2
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
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=yes`
    );

    if (!popup || popup.closed) {
      resolve({ completed: false });
      return;
    }

    let resolved = false;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== globalThis.window.location.origin) {
        return;
      }
      if (event.data?.type !== "zentity:oauth:complete") {
        return;
      }

      resolved = true;
      cleanup();

      if (event.data.error) {
        resolve({
          completed: false,
          error: event.data.error as string,
          errorDescription: event.data.errorDescription as string | undefined,
        });
      } else {
        resolve({ completed: true });
      }
    };

    const pollTimer = setInterval(() => {
      if (popup.closed && !resolved) {
        resolved = true;
        cleanup();
        resolve({ completed: false });
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

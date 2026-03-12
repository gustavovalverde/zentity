"use client";

import { useEffect } from "react";

export default function OAuthPopupCompletePage() {
  useEffect(() => {
    if (!globalThis.window.opener) {
      globalThis.window.location.assign("/");
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const error = params.get("error");

    globalThis.window.opener.postMessage(
      {
        type: "zentity:oauth:complete",
        ...(error && {
          error,
          errorDescription: params.get("error_description"),
        }),
      },
      globalThis.window.location.origin
    );
    globalThis.window.close();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">
        This window will close automatically.
      </p>
    </div>
  );
}

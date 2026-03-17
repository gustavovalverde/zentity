"use client";

import { useEffect } from "react";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    fetch("/api/log-client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        digest: error.digest,
        path: globalThis.window?.location?.pathname,
        stack: error.stack,
        source: "global-error-boundary",
      }),
    }).catch(() => {
      // Logging failure should not cascade to user
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background font-sans text-foreground antialiased">
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <svg
                  aria-hidden="true"
                  className="h-6 w-6 text-destructive"
                  fill="none"
                  role="img"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Error</title>
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
              </div>
              <div>
                <h1 className="font-semibold text-lg tracking-tight">
                  Something went wrong
                </h1>
                <p className="mt-1 text-muted-foreground text-sm">
                  An unexpected error occurred. Please try again.
                </p>
              </div>
              {process.env.NODE_ENV === "development" && error.message && (
                <div className="w-full rounded-lg bg-muted p-3 text-left">
                  <p className="break-all font-mono text-muted-foreground text-xs">
                    {error.message}
                  </p>
                  {error.digest ? (
                    <p className="mt-1 text-muted-foreground text-xs">
                      Error ID: {error.digest}
                    </p>
                  ) : null}
                </div>
              )}
              <button
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={reset}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

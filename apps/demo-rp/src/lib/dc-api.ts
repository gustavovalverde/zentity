/**
 * W3C Digital Credentials API wrapper (experimental).
 *
 * Provides progressive enhancement for browsers that support the
 * Digital Credentials API (Chrome 128+ behind flag).
 */

/**
 * Feature detection for the Digital Credentials API.
 */
export function isDcApiAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    "credentials" in navigator &&
    "digital" in (navigator.credentials as unknown as Record<string, unknown>)
  );
}

/**
 * Invokes the Digital Credentials API to request a verifiable presentation.
 *
 * The browser prompts the user to select a wallet and present credentials.
 * Returns the raw response from the DC API.
 */
export async function requestPresentation(
  signedRequest: string
): Promise<unknown> {
  if (!isDcApiAvailable()) {
    throw new Error("Digital Credentials API not available");
  }

  // The DC API uses navigator.credentials.get with a "digital" provider
  const credential = await (
    navigator.credentials as unknown as {
      get(options: {
        digital: {
          providers: Array<{
            protocol: string;
            request: string;
          }>;
        };
      }): Promise<{ data?: unknown }>;
    }
  ).get({
    digital: {
      providers: [
        {
          protocol: "openid4vp",
          request: signedRequest,
        },
      ],
    },
  });

  return credential?.data;
}

import type { DpopClient } from "./dpop-client";

export interface FetchUserInfoOptions {
  accessToken: string;
  dpopClient?: Pick<DpopClient, "proofFor" | "withNonceRetry">;
  unwrapResponseEnvelope?: boolean;
  userInfoUrl: string | URL;
}

function toUrlString(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

function unwrapResponseBody(
  body: Record<string, unknown>,
  unwrapResponseEnvelope: boolean
) {
  if (
    unwrapResponseEnvelope &&
    typeof body.response === "object" &&
    body.response !== null &&
    !Array.isArray(body.response)
  ) {
    return body.response as Record<string, unknown>;
  }

  return body;
}

export async function fetchUserInfo(
  options: FetchUserInfoOptions
): Promise<Record<string, unknown> | null> {
  const userInfoUrl = toUrlString(options.userInfoUrl);

  if (options.dpopClient) {
    const dpopClient = options.dpopClient;
    const { response } = await dpopClient.withNonceRetry(
      async (nonce) => {
        const proof = await dpopClient.proofFor(
          "GET",
          userInfoUrl,
          options.accessToken,
          nonce
        );
        const response = await fetch(userInfoUrl, {
          headers: {
            Authorization: `DPoP ${options.accessToken}`,
            DPoP: proof,
          },
        });
        return { response, result: null };
      }
    );

    if (!response.ok) {
      return null;
    }

    return unwrapResponseBody(
      (await response.json()) as Record<string, unknown>,
      options.unwrapResponseEnvelope ?? true
    );
  }

  const response = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
    },
  });
  if (!response.ok) {
    return null;
  }

  return unwrapResponseBody(
    (await response.json()) as Record<string, unknown>,
    options.unwrapResponseEnvelope ?? true
  );
}

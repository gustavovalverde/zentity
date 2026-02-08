import type { Eip712TypedData } from "./types";

interface BetterFetchResponse<T> {
  data: T | null;
  error: {
    message?: string;
    code?: string;
  } | null;
}

type ClientFetch = <T>(
  path: string,
  options?: Record<string, unknown>
) => Promise<BetterFetchResponse<T>>;

type SignTypedDataFn = (typedData: Eip712TypedData) => Promise<string>;

function extractError(
  error: BetterFetchResponse<unknown>["error"],
  fallback: string
): string {
  if (!error) {
    return fallback;
  }
  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

export const eip712AuthClient = () => ({
  id: "eip712",
  getActions($fetch: ClientFetch) {
    return {
      signUp: {
        eip712: async (params: {
          address: string;
          chainId: number;
          signTypedData: SignTypedDataFn;
          email?: string;
        }) => {
          // Step 1: Request nonce + typed data from server
          const nonceRes = await $fetch<{
            nonce: string;
            typedData: Eip712TypedData;
          }>("/eip712/nonce", {
            method: "POST",
            body: {
              address: params.address,
              chainId: params.chainId,
            },
          });

          if (nonceRes.error || !nonceRes.data) {
            throw new Error(
              extractError(nonceRes.error, "Failed to request nonce")
            );
          }

          // Step 2: Sign typed data with wallet
          const signature = await params.signTypedData(nonceRes.data.typedData);

          // Step 3: Register with server
          const registerRes = await $fetch<{
            token: string;
            user: { id: string };
          }>("/sign-up/eip712/register", {
            method: "POST",
            body: {
              signature,
              address: params.address,
              chainId: params.chainId,
              nonce: nonceRes.data.nonce,
              ...(params.email ? { email: params.email } : {}),
            },
          });

          if (registerRes.error || !registerRes.data) {
            throw new Error(
              extractError(registerRes.error, "Wallet registration failed")
            );
          }

          return registerRes.data;
        },
      },
      signIn: {
        eip712: async (params: {
          address: string;
          chainId: number;
          signTypedData: SignTypedDataFn;
        }) => {
          // Step 1: Request nonce + typed data from server
          const nonceRes = await $fetch<{
            nonce: string;
            typedData: Eip712TypedData;
          }>("/eip712/nonce", {
            method: "POST",
            body: {
              address: params.address,
              chainId: params.chainId,
            },
          });

          if (nonceRes.error || !nonceRes.data) {
            throw new Error(
              extractError(nonceRes.error, "Failed to request nonce")
            );
          }

          // Step 2: Sign typed data with wallet
          const signature = await params.signTypedData(nonceRes.data.typedData);

          // Step 3: Verify with server
          const verifyRes = await $fetch<{
            token: string;
            user: { id: string };
          }>("/sign-in/eip712/verify", {
            method: "POST",
            body: {
              signature,
              address: params.address,
              chainId: params.chainId,
              nonce: nonceRes.data.nonce,
            },
          });

          if (verifyRes.error || !verifyRes.data) {
            throw new Error(
              extractError(verifyRes.error, "Wallet sign-in failed")
            );
          }

          return verifyRes.data;
        },
      },
    };
  },
});

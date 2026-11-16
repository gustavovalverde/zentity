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

/** Signs an EIP-4361 message with EIP-191 `personal_sign`. */
type SignMessageFn = (message: string) => Promise<string>;

interface WalletAuthResult {
  token: string;
  user: { id: string };
}

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

async function requestChallenge(
  $fetch: ClientFetch,
  path: string,
  params: { address: string; chainId: number }
): Promise<string> {
  const response = await $fetch<{ message: string }>(path, {
    method: "POST",
    body: { address: params.address, chainId: params.chainId },
  });
  if (response.error || !response.data) {
    throw new Error(
      extractError(response.error, "Failed to request a sign-in message")
    );
  }
  return response.data.message;
}

export const siweAuthClient = () => ({
  id: "siwe",
  getActions($fetch: ClientFetch) {
    return {
      signUp: {
        siwe: async (params: {
          address: string;
          chainId: number;
          signMessage: SignMessageFn;
          email?: string;
        }) => {
          const message = await requestChallenge(
            $fetch,
            "/sign-up/siwe/challenge",
            params
          );

          // Wallet key wrapping needs a signer that repeats its signatures,
          // so a wallet that signs the same message differently is refused
          // before an account exists.
          const signature1 = await params.signMessage(message);
          const signature2 = await params.signMessage(message);
          if (signature1 !== signature2) {
            throw new Error(
              "wallet_nondeterministic: Wallet signatures are not stable for this message. " +
                "Use passkey/password sign-up, or switch wallets and set up backup recovery."
            );
          }

          const registerRes = await $fetch<WalletAuthResult>(
            "/sign-up/siwe/complete",
            {
              method: "POST",
              body: {
                message,
                signature: signature1,
                signature2,
                ...(params.email ? { email: params.email } : {}),
              },
            }
          );

          if (registerRes.error || !registerRes.data) {
            throw new Error(
              extractError(registerRes.error, "Wallet registration failed")
            );
          }

          return registerRes.data;
        },
      },
      signIn: {
        siwe: async (params: {
          address: string;
          chainId: number;
          signMessage: SignMessageFn;
        }) => {
          const message = await requestChallenge(
            $fetch,
            "/sign-in/siwe/challenge",
            params
          );
          const signature = await params.signMessage(message);

          const verifyRes = await $fetch<WalletAuthResult>(
            "/sign-in/siwe/complete",
            { method: "POST", body: { message, signature } }
          );

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

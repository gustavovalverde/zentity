import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";
import type { DpopNonceOptions } from "@better-auth/core/oauth2";

import { oauthProviderOptions } from "@/lib/auth/oidc/oauth-provider";

/**
 * DPoP on Zentity's own endpoints, under the OAuth provider's `dpop`
 * settings, so every endpoint on the origin accepts the same proofs and
 * nonces as the token endpoint. The provider API's `verifyDpopProof` and
 * `issueDpopNonce` serve endpoints under the auth base path.
 */

interface DpopSettings {
  /** Present when the provider requires server-provided nonces. */
  nonce: DpopNonceOptions | undefined;
  proofMaxAgeSeconds: number | undefined;
  signingAlgorithms: readonly string[] | undefined;
}

/**
 * The provider's DPoP settings, for the checks its API does not make:
 * sender-constrained tokens at Zentity's protected resources. Nonces are keyed from the auth secret, as the
 * provider keys them.
 */
export function providerDpopSettings(
  ctx: Pick<GenericEndpointContext, "context">
): DpopSettings {
  const { dpop } = oauthProviderOptions(ctx.context);
  return {
    nonce: dpop?.nonce?.required
      ? { secret: ctx.context.secret, expiresIn: dpop.nonce.expiresIn }
      : undefined,
    proofMaxAgeSeconds: dpop?.proofMaxAgeSeconds,
    signingAlgorithms: dpop?.signingAlgorithms,
  };
}

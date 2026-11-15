import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";
import type { DpopNonceOptions } from "@better-auth/core/oauth2";

import {
  getOAuthProviderApi,
  type OAuthOptions,
  type Scope,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";

/**
 * DPoP on Zentity's own endpoints, under the OAuth provider's `dpop`
 * settings, so every endpoint on the origin accepts the same proofs and
 * nonces as the token endpoint.
 */

function oauthProviderOptions(
  ctx: Pick<GenericEndpointContext, "context">
): OAuthOptions<Scope[]> {
  const plugin = ctx.context.getPlugin("oauth-provider") as {
    options: OAuthOptions<Scope[]>;
  } | null;
  if (!plugin) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: "oauth-provider plugin is required",
    });
  }
  return plugin.options;
}

/**
 * The provider's API bound to this request. Its `verifyDpopProof` and
 * `issueDpopNonce` serve endpoints under the auth base path.
 */
export function oauthProviderApi(ctx: GenericEndpointContext) {
  return getOAuthProviderApi(ctx, oauthProviderOptions(ctx));
}

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
  const { dpop } = oauthProviderOptions(ctx);
  return {
    nonce: dpop?.nonce?.required
      ? { secret: ctx.context.secret, expiresIn: dpop.nonce.expiresIn }
      : undefined,
    proofMaxAgeSeconds: dpop?.proofMaxAgeSeconds,
    signingAlgorithms: dpop?.signingAlgorithms,
  };
}

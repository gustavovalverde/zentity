import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";

import {
  type DpopNonceOptions,
  isDpopProofError,
  verifyDpopProof,
} from "@better-auth/core/oauth2";
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
 * sender-constrained tokens at Zentity's protected resources and the nonce
 * check before the token hooks. Nonces are keyed from the auth secret, as the
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

/**
 * Answers a token request whose DPoP proof is valid but lacks a current nonce
 * with `use_dpop_nonce` and the nonce to retry with (RFC 9449 §8), without
 * reserving the proof's `jti`. Zentity's token hooks run this before any hook
 * that stages state for the grant, such as the identity release an
 * authorization code carries or the CIBA token stash: the provider makes the
 * same check only once the hooks have run, and the client's retry must redeem
 * the same grant. Better Auth has no nonce-only check for hooks yet. Any other
 * proof failure is left to the provider.
 */
export async function challengeMissingTokenDpopNonce(
  ctx: GenericEndpointContext
): Promise<void> {
  const proofJwt = ctx.headers?.get("DPoP");
  const settings = providerDpopSettings(ctx);
  if (!(proofJwt && settings.nonce)) {
    return;
  }
  try {
    await verifyDpopProof({
      proofJwt,
      method: "POST",
      url: `${ctx.context.baseURL}/oauth2/token`,
      signingAlgorithms: settings.signingAlgorithms,
      proofMaxAgeSeconds: settings.proofMaxAgeSeconds,
      nonce: settings.nonce,
    });
  } catch (error) {
    if (!isDpopProofError(error)) {
      throw error;
    }
    if (error.code === "use_dpop_nonce") {
      await oauthProviderApi(ctx).issueDpopNonce();
      // A before-hook error reaches the client with its own headers only.
      throw new APIError(
        "BAD_REQUEST",
        { error: error.code, error_description: error.message },
        ctx.responseHeaders
      );
    }
  }
}

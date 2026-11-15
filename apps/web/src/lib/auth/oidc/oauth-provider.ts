import "server-only";

import type { AuthContext, GenericEndpointContext } from "@better-auth/core";

import {
  getOAuthProviderApi,
  type OAuthOptions,
  type Scope,
  type StoreTokenType,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";

/** Any auth context, including the typed one `auth.$context` resolves to. */
type ProviderContext = Pick<AuthContext, "getPlugin">;

/** The options the OAuth provider plugin was registered with. */
export function oauthProviderOptions(
  context: ProviderContext
): OAuthOptions<Scope[]> {
  const plugin = context.getPlugin("oauth-provider");
  if (!plugin) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: "oauth-provider plugin is required",
    });
  }
  return plugin.options;
}

/** The provider's API bound to this request. */
export function oauthProviderApi(ctx: GenericEndpointContext) {
  return getOAuthProviderApi(ctx, oauthProviderOptions(ctx.context));
}

/**
 * Hashes a value the way the provider stores it, for lookups outside a
 * request. `hashToken` reads only the provider options, so the auth context
 * stands in for the endpoint context.
 */
export async function hashProviderToken(
  context: ProviderContext,
  token: string,
  type: StoreTokenType
): Promise<string> {
  const ctx = { context } as unknown as GenericEndpointContext;
  return await getOAuthProviderApi(
    ctx,
    oauthProviderOptions(context)
  ).hashToken(token, type);
}

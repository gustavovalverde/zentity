const DEFAULT_LOOPBACK_REDIRECT_URI = "http://127.0.0.1/callback";
const TRAILING_SLASHES_RE = /\/+$/;
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

export interface BuildLoopbackClientRegistrationOptions {
  clientName: string;
  grantTypes: readonly string[];
  redirectUri?: string;
  responseTypes?: readonly string[];
  scope: string;
  tokenEndpointAuthMethod?: string;
}

export function normalizeUrl(value: string): string {
  return value.replace(TRAILING_SLASHES_RE, "");
}

function cibaDeliveryMetadata(
  grantTypes: readonly string[]
): Record<string, unknown> {
  return grantTypes.includes(CIBA_GRANT_TYPE)
    ? { backchannel_token_delivery_mode: "poll" }
    : {};
}

export function buildLoopbackClientRegistration(
  options: BuildLoopbackClientRegistrationOptions
): Record<string, unknown> {
  return {
    application_type: "native",
    client_name: options.clientName,
    grant_types: [...options.grantTypes],
    redirect_uris: [options.redirectUri ?? DEFAULT_LOOPBACK_REDIRECT_URI],
    response_types: [...(options.responseTypes ?? ["code"])],
    scope: options.scope,
    token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? "none",
    ...cibaDeliveryMetadata(options.grantTypes),
  };
}

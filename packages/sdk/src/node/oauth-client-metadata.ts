const DEFAULT_LOOPBACK_REDIRECT_URI = "http://127.0.0.1/callback";
const TRAILING_SLASHES_RE = /\/+$/;

export interface BuildLoopbackClientRegistrationOptions {
  clientName: string;
  grantTypes: readonly string[];
  redirectUri?: string;
  responseTypes?: readonly string[];
  scope: string;
  tokenEndpointAuthMethod?: string;
}

export interface BuildOAuthClientMetadataOptions {
  clientId: string;
  clientName: string;
  grantTypes: readonly string[];
  redirectUris: readonly string[];
  scope: string;
  tokenEndpointAuthMethod?: string;
}

export function normalizeUrl(value: string): string {
  return value.replace(TRAILING_SLASHES_RE, "");
}

export function buildLoopbackClientRegistration(
  options: BuildLoopbackClientRegistrationOptions
): Record<string, unknown> {
  return {
    client_name: options.clientName,
    grant_types: [...options.grantTypes],
    redirect_uris: [options.redirectUri ?? DEFAULT_LOOPBACK_REDIRECT_URI],
    response_types: [...(options.responseTypes ?? ["code"])],
    scope: options.scope,
    token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? "none",
  };
}

export function buildOAuthClientMetadata(
  options: BuildOAuthClientMetadataOptions
): Record<string, unknown> {
  return {
    client_id: options.clientId,
    client_name: options.clientName,
    grant_types: [...options.grantTypes],
    redirect_uris: [...options.redirectUris],
    scope: options.scope,
    token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? "none",
  };
}

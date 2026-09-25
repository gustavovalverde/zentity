import {
  createDiscoveryResolver as createBaseDiscoveryResolver,
  type DiscoveryDocument,
} from "../protocol/discovery";

export interface FirstPartyAuthDiscoveryDocument {
  authorization_challenge_endpoint?: string;
  authorization_endpoint: string;
  backchannel_authentication_endpoint?: string;
  client_id_metadata_document_supported?: boolean;
  dpop_signing_alg_values_supported?: string[];
  issuer: string;
  jwks_uri?: string;
  pushed_authorization_request_endpoint?: string;
  registration_endpoint?: string;
  require_pushed_authorization_requests?: boolean;
  token_endpoint: string;
}

export interface CreateDiscoveryResolverOptions {
  discoveryTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  issuerUrl: string | URL;
}

export interface DiscoveryResolver {
  clear(): void;
  peek(): FirstPartyAuthDiscoveryDocument | undefined;
  read(): Promise<FirstPartyAuthDiscoveryDocument>;
}

function isFirstPartyDocument(
  document: DiscoveryDocument
): document is FirstPartyAuthDiscoveryDocument {
  return (
    typeof document.token_endpoint === "string" &&
    typeof document.authorization_endpoint === "string"
  );
}

function requireFirstPartyDocument(
  document: DiscoveryDocument
): FirstPartyAuthDiscoveryDocument {
  if (!isFirstPartyDocument(document)) {
    throw new Error(
      "OpenID discovery response missing token_endpoint or authorization_endpoint"
    );
  }
  return document;
}

export function createDiscoveryResolver(
  options: CreateDiscoveryResolverOptions
): DiscoveryResolver {
  const base = createBaseDiscoveryResolver(options);

  return {
    clear() {
      base.clear();
    },
    peek() {
      const document = base.peek();
      if (!document || !isFirstPartyDocument(document)) {
        return undefined;
      }
      return document;
    },
    async read() {
      return requireFirstPartyDocument(await base.read());
    },
  };
}

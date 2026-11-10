import type { OAuthProviderExtension } from "@better-auth/oauth-provider";

import { APIError } from "better-auth";

import { validateResourceUri } from "@/lib/auth/oidc/oauth-request";
import { validateOutboundUrl } from "@/lib/http/url-safety";

/** The protected resource an agent client's exchanged tokens target. */
export const PROTECTED_RESOURCE_METADATA_FIELD = "zentity_protected_resource";

/** Where Zentity pushes validity notices; registering it opts the client in. */
export const RP_VALIDITY_NOTICE_URI_FIELD = "rp_validity_notice_uri";

// Declared by the CIBA plugin, which only checks it for ping delivery.
const CIBA_NOTIFICATION_ENDPOINT_FIELD =
  "backchannel_client_notification_endpoint";

function invalidClientMetadata(description: string): never {
  throw new APIError("BAD_REQUEST", {
    error: "invalid_client_metadata",
    error_description: description,
  });
}

function assertOutboundUrl(field: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const problem =
    typeof value === "string" ? validateOutboundUrl(value) : "must be a string";
  if (problem) {
    invalidClientMetadata(`${field} ${problem}`);
  }
}

/**
 * Zentity's client registration fields. The provider keeps them in the
 * client's `metadata` for dynamic registration, client metadata documents,
 * and admin-created clients, and runs this validator on each.
 */
export const clientMetadataExtension: OAuthProviderExtension = {
  clientMetadata: {
    fields: [PROTECTED_RESOURCE_METADATA_FIELD, RP_VALIDITY_NOTICE_URI_FIELD],
    validate: ({ metadata }) => {
      // Both URLs are fetched by Zentity's server, so neither may reach an
      // internal address.
      assertOutboundUrl(
        RP_VALIDITY_NOTICE_URI_FIELD,
        metadata[RP_VALIDITY_NOTICE_URI_FIELD]
      );
      assertOutboundUrl(
        CIBA_NOTIFICATION_ENDPOINT_FIELD,
        metadata[CIBA_NOTIFICATION_ENDPOINT_FIELD]
      );

      const protectedResource = metadata[PROTECTED_RESOURCE_METADATA_FIELD];
      if (protectedResource === undefined) {
        return;
      }
      const result = validateResourceUri(protectedResource);
      if (!result.valid) {
        invalidClientMetadata(
          `${PROTECTED_RESOURCE_METADATA_FIELD}: ${result.error}`
        );
      }
    },
  },
};

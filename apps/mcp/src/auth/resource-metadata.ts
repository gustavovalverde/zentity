import { config } from "../config.js";

export function getResourceMetadata(): Record<string, unknown> {
  return {
    resource: config.mcpPublicUrl,
    authorization_servers: [config.zentityUrl],
    scopes_supported: [
      "openid",
      "email",
      "proof:identity",
      "identity.name",
      "identity.address",
    ],
    bearer_methods_supported: ["header"],
  };
}

import { describe, expect, it } from "vitest";
import {
  buildLoopbackClientRegistration,
  buildOAuthClientMetadata,
  normalizeUrl,
} from "./oauth-client-metadata.js";

describe("oauth client metadata helpers", () => {
  it("builds a loopback registration request with the default redirect URI", () => {
    expect(
      buildLoopbackClientRegistration({
        clientName: "Example CLI",
        grantTypes: ["authorization_code", "refresh_token"],
        scope: "openid offline_access",
      })
    ).toEqual({
      client_name: "Example CLI",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code"],
      scope: "openid offline_access",
      token_endpoint_auth_method: "none",
    });
  });

  it("builds a public OAuth client metadata document", () => {
    expect(
      buildOAuthClientMetadata({
        clientId: "https://example.com/.well-known/oauth-client.json",
        clientName: "Example MCP",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["http://127.0.0.1/callback"],
        scope: "openid",
      })
    ).toEqual({
      client_id: "https://example.com/.well-known/oauth-client.json",
      client_name: "Example MCP",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback"],
      scope: "openid",
      token_endpoint_auth_method: "none",
    });
  });

  it("normalizes trailing slashes from URLs", () => {
    expect(normalizeUrl("https://example.com/base///")).toBe(
      "https://example.com/base"
    );
  });
});

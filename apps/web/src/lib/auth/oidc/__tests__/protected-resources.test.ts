import { describe, expect, it } from "vitest";

import {
  getFirstPartyProtectedResourceAudiences,
  resolveProtectedResourceAudience,
} from "@/lib/auth/oidc/protected-resources";

const INVALID_RESOURCE_ERROR_RE = /requested resource invalid/i;

const RESOURCE_CONFIG = {
  appUrl: "http://localhost:3000",
  authIssuer: "http://localhost:3000/api/auth",
  mcpPublicUrl: "http://localhost:3200",
  oidc4vciCredentialAudience:
    "http://localhost:3000/api/auth/oidc4vci/credential",
  rpApiAudience: "http://localhost:3000/api/auth/resource/rp-api",
};

describe("protected resource registry", () => {
  it("keeps the static first-party audience list focused on web-owned resources", () => {
    expect(
      getFirstPartyProtectedResourceAudiences({
        appUrl: RESOURCE_CONFIG.appUrl,
        authIssuer: RESOURCE_CONFIG.authIssuer,
        oidc4vciCredentialAudience: RESOURCE_CONFIG.oidc4vciCredentialAudience,
        rpApiAudience: RESOURCE_CONFIG.rpApiAudience,
      })
    ).toEqual([
      "http://localhost:3000",
      "http://localhost:3000/api/auth",
      "http://localhost:3000/api/auth/oidc4vci/credential",
      "http://localhost:3000/api/auth/resource/rp-api",
    ]);
  });

  it("allows the MCP protected resource for user-bound grants", () => {
    expect(
      resolveProtectedResourceAudience(RESOURCE_CONFIG, {
        baseURL: RESOURCE_CONFIG.appUrl,
        grantType: "urn:openid:params:grant-type:ciba",
        resource: "http://localhost:3200/",
        scopes: ["openid"],
      })
    ).toBe("http://localhost:3200");
  });

  it("rejects the MCP protected resource for client_credentials grants", () => {
    expect(() =>
      resolveProtectedResourceAudience(RESOURCE_CONFIG, {
        baseURL: RESOURCE_CONFIG.appUrl,
        grantType: "client_credentials",
        resource: RESOURCE_CONFIG.mcpPublicUrl,
        scopes: ["proof:identity"],
      })
    ).toThrowError(INVALID_RESOURCE_ERROR_RE);
  });
});

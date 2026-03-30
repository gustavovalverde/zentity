import { describe, expect, it } from "vitest";

import { getProtectedResourceAudiences } from "@/lib/auth/oidc/protected-resources";

const RESOURCE_CONFIG = {
  appUrl: "http://localhost:3000",
  authIssuer: "http://localhost:3000/api/auth",
  mcpPublicUrl: "http://localhost:3200",
  oidc4vciCredentialAudience:
    "http://localhost:3000/api/auth/oidc4vci/credential",
  rpApiAudience: "http://localhost:3000/api/auth/resource/rp-api",
};

describe("protected resource registry", () => {
  it("returns deduplicated audiences including MCP", () => {
    expect(getProtectedResourceAudiences(RESOURCE_CONFIG)).toEqual([
      "http://localhost:3000",
      "http://localhost:3000/api/auth",
      "http://localhost:3200",
      "http://localhost:3000/api/auth/oidc4vci/credential",
      "http://localhost:3000/api/auth/resource/rp-api",
    ]);
  });

  it("strips trailing slashes for consistent comparison", () => {
    const audiences = getProtectedResourceAudiences({
      ...RESOURCE_CONFIG,
      mcpPublicUrl: "http://localhost:3200/",
    });
    expect(audiences).toContain("http://localhost:3200");
    expect(audiences).not.toContain("http://localhost:3200/");
  });

  it("deduplicates when authIssuer equals appUrl", () => {
    const audiences = getProtectedResourceAudiences({
      ...RESOURCE_CONFIG,
      authIssuer: RESOURCE_CONFIG.appUrl,
    });
    const appUrlCount = audiences.filter(
      (a) => a === "http://localhost:3000"
    ).length;
    expect(appUrlCount).toBe(1);
  });
});

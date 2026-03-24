import { describe, expect, it } from "vitest";

import {
  areAllRedirectUrisLocal,
  extractMetadataHostname,
} from "../consent-view-model";

describe("consent view model", () => {
  it("extracts a display hostname from metadata URLs", () => {
    expect(
      extractMetadataHostname("https://wallet.example.com/.well-known/client")
    ).toBe("wallet.example.com");
    expect(extractMetadataHostname("not-a-url")).toBeNull();
    expect(extractMetadataHostname(null)).toBeNull();
  });

  it("marks an app local only when every redirect URI is loopback", () => {
    expect(
      areAllRedirectUrisLocal([
        "http://localhost:3000/callback",
        "http://127.0.0.1:54324/callback",
        "http://[::1]:7777/callback",
      ])
    ).toBe(true);
    expect(
      areAllRedirectUrisLocal([
        "http://localhost:3000/callback",
        "https://rp.example.com/callback",
      ])
    ).toBe(false);
    expect(areAllRedirectUrisLocal([])).toBe(false);
    expect(areAllRedirectUrisLocal(null)).toBe(false);
  });
});

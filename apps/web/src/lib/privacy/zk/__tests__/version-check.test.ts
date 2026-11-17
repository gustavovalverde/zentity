import { describe, expect, it } from "vitest";

import { normalizeVersion, readInstalledVersion } from "../version-check";

const SEMVER = /^\d+\.\d+\.\d+/;

describe("readInstalledVersion", () => {
  it("resolves packages whose export map hides package.json", () => {
    expect(readInstalledVersion("@aztec-foundation/bb.js")).toMatch(SEMVER);
    expect(readInstalledVersion("@noir-lang/noir_js")).toMatch(SEMVER);
  });

  it("returns null for packages that are not installed", () => {
    expect(readInstalledVersion("@zentity/not-installed")).toBeNull();
  });
});

describe("normalizeVersion", () => {
  it("drops build metadata", () => {
    expect(normalizeVersion("1.0.0+abc123")).toBe("1.0.0");
  });

  it("returns null for empty input", () => {
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion("")).toBeNull();
  });
});

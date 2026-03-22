import { describe, expect, it } from "vitest";

import { transformHref } from "../markdown-renderer";

describe("transformHref", () => {
  it("resolves known .md file to /docs/ route", () => {
    const result = transformHref("architecture.md");
    expect(result).toEqual({
      href: "/docs/architecture",
      isInternal: true,
      isExternal: false,
    });
  });

  it("preserves fragment on known .md file", () => {
    const result = transformHref("agent-architecture.md#binding-chains");
    expect(result).toEqual({
      href: "/docs/agent-architecture#binding-chains",
      isInternal: true,
      isExternal: false,
    });
  });

  it("resolves ../ prefixed .md with fragment", () => {
    const result = transformHref("../docs/zk-architecture.md#bn254");
    expect(result).toEqual({
      href: "/docs/zk-architecture#bn254",
      isInternal: true,
      isExternal: false,
    });
  });

  it("falls back to GitHub for unknown .md with fragment", () => {
    const result = transformHref("unknown-doc.md#section");
    expect(result).toEqual({
      href: "https://github.com/gustavovalverde/zentity/blob/main/docs/unknown-doc.md#section",
      isInternal: false,
      isExternal: true,
    });
  });

  it("links README.md with fragment to GitHub", () => {
    const result = transformHref("readme.md#section");
    expect(result).toEqual({
      href: "https://github.com/gustavovalverde/zentity/blob/main/README.md#section",
      isInternal: false,
      isExternal: true,
    });
  });

  it("leaves anchor-only links unchanged", () => {
    const result = transformHref("#anchor-only");
    expect(result).toEqual({
      href: "#anchor-only",
      isInternal: false,
      isExternal: false,
    });
  });

  it("leaves external links with fragments unchanged", () => {
    const result = transformHref("https://example.com/page#hash");
    expect(result).toEqual({
      href: "https://example.com/page#hash",
      isInternal: false,
      isExternal: true,
    });
  });

  it("resolves plain .md without fragment (regression)", () => {
    const result = transformHref("oauth-integrations.md");
    expect(result).toEqual({
      href: "/docs/oauth-integrations",
      isInternal: true,
      isExternal: false,
    });
  });

  it("returns # for undefined href", () => {
    const result = transformHref(undefined);
    expect(result).toEqual({
      href: "#",
      isInternal: false,
      isExternal: false,
    });
  });
});

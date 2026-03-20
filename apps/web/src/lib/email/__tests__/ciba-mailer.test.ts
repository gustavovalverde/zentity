import { describe, expect, it } from "vitest";

import {
  extractAgentIdentity,
  formatAgentHtml,
  formatAgentText,
} from "../ciba-mailer";

describe("extractAgentIdentity", () => {
  it("extracts identity from valid JSON string", () => {
    const result = extractAgentIdentity(
      JSON.stringify({
        agent: {
          name: "Claude",
          model: "opus-4-6",
          runtime: "cli",
          version: "1.0",
        },
      })
    );
    expect(result).toEqual({
      name: "Claude",
      model: "opus-4-6",
      runtime: "cli",
      version: "1.0",
    });
  });

  it("extracts identity from object (non-string)", () => {
    const result = extractAgentIdentity({
      agent: { name: "Test Agent" },
    });
    expect(result).toEqual({
      name: "Test Agent",
      model: undefined,
      runtime: undefined,
      version: undefined,
    });
  });

  it("returns null for null input", () => {
    expect(extractAgentIdentity(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractAgentIdentity(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractAgentIdentity("")).toBeNull();
  });

  it("returns null when agent.name is missing", () => {
    expect(
      extractAgentIdentity(JSON.stringify({ agent: { model: "gpt-4" } }))
    ).toBeNull();
  });

  it("extracts minimal identity (name only)", () => {
    const result = extractAgentIdentity(
      JSON.stringify({ agent: { name: "MinAgent" } })
    );
    expect(result).toEqual({
      name: "MinAgent",
      model: undefined,
      runtime: undefined,
      version: undefined,
    });
  });
});

describe("formatAgentText", () => {
  it("formats full agent identity", () => {
    const text = formatAgentText({
      name: "Claude Code",
      model: "opus-4-6",
      runtime: "cli",
      version: "1.2.3",
    });
    expect(text).toContain("Claude Code");
    expect(text).toContain("Model: opus-4-6");
    expect(text).toContain("Runtime: cli");
    expect(text).toContain("Version: 1.2.3");
    expect(text).toContain("Unverified");
  });

  it("formats name-only agent", () => {
    const text = formatAgentText({ name: "Simple Agent" });
    expect(text).toContain("Simple Agent");
    expect(text).not.toContain("Model:");
    expect(text).not.toContain("Runtime:");
  });
});

describe("formatAgentHtml", () => {
  it("includes agent name in bold", () => {
    const html = formatAgentHtml({ name: "Test" });
    expect(html).toContain("<strong>Test</strong>");
  });

  it("includes model when present", () => {
    const html = formatAgentHtml({ name: "Test", model: "gpt-4" });
    expect(html).toContain("Model: gpt-4");
  });

  it("includes version with v prefix", () => {
    const html = formatAgentHtml({ name: "Test", version: "2.0" });
    expect(html).toContain("v2.0");
  });

  it("includes Unverified label", () => {
    const html = formatAgentHtml({ name: "Test" });
    expect(html).toContain("Unverified");
  });
});

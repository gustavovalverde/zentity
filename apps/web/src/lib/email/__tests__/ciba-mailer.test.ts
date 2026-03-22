import { describe, expect, it } from "vitest";

import { formatAgentHtml, formatAgentText } from "../ciba-mailer";

describe("formatAgentText", () => {
  it("formats registered agent identity", () => {
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
    expect(text).toContain("Registered runtime");
  });

  it("formats attested agents with provider details", () => {
    const text = formatAgentText({
      name: "Aether",
      attestationProvider: "AgentPass",
      attestationTier: "attested",
    });
    expect(text).toContain("Attested by AgentPass");
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

  it("includes registered runtime label by default", () => {
    const html = formatAgentHtml({ name: "Test" });
    expect(html).toContain("Registered runtime");
  });
});

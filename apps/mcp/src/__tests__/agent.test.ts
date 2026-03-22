import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAgent, prefixBindingMessage } from "../agent.js";

describe("detectAgent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps claude-code to Claude Code", () => {
    const agent = detectAgent({ name: "claude-code", version: "1.2.3" });

    expect(agent).toEqual({
      name: "Claude Code",
      model: "claude",
      version: "1.2.3",
      runtime: "node",
    });
  });

  it("maps codex-cli to Codex", () => {
    const agent = detectAgent({ name: "codex-cli", version: "0.5.0" });

    expect(agent.name).toBe("Codex");
    expect(agent.model).toBe("codex");
  });

  it("maps opencode to OpenCode", () => {
    const agent = detectAgent({ name: "opencode", version: "2.0.0" });

    expect(agent.name).toBe("OpenCode");
    expect(agent.model).toBe("opencode");
  });

  it("passes through unknown client names verbatim", () => {
    const agent = detectAgent({ name: "my-custom-agent", version: "3.0.0" });

    expect(agent.name).toBe("my-custom-agent");
    expect(agent.model).toBe("unknown");
    expect(agent.version).toBe("3.0.0");
  });

  it("falls back to ZENTITY_AGENT_NAME when clientInfo is absent", () => {
    vi.stubEnv("ZENTITY_AGENT_NAME", "My Agent");
    const agent = detectAgent(undefined);

    expect(agent.name).toBe("My Agent");
    expect(agent.model).toBe("unknown");
    expect(agent.version).toBe("unknown");
  });

  it("throws when both clientInfo and env var are absent", () => {
    expect(() => detectAgent(undefined)).toThrow(
      "MCP clientInfo is required"
    );
  });

  it("prefers clientInfo over ZENTITY_AGENT_NAME", () => {
    vi.stubEnv("ZENTITY_AGENT_NAME", "Ignored");
    const agent = detectAgent({ name: "claude-code", version: "1.0.0" });

    expect(agent.name).toBe("Claude Code");
  });
});

describe("prefixBindingMessage", () => {
  it("prefixes message with agent name", () => {
    expect(
      prefixBindingMessage(
        "Claude Code",
        "Purchase Widget Pro from Acme Store for 49.99 USD"
      )
    ).toBe("Claude Code: Purchase Widget Pro from Acme Store for 49.99 USD");
  });

  it("works with explicit fallback names", () => {
    expect(prefixBindingMessage("My Agent", "Approve action")).toBe(
      "My Agent: Approve action"
    );
  });
});

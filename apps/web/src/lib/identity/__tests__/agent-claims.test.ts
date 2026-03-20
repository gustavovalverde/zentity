import { describe, expect, it } from "vitest";

import { parseAgentClaims } from "../agent-claims";

describe("parseAgentClaims", () => {
  it("parses valid minimal claims (agent.name only)", () => {
    const result = parseAgentClaims(
      JSON.stringify({ agent: { name: "Test Agent" } })
    );
    expect(result).toEqual({ agent: { name: "Test Agent" } });
  });

  it("parses valid full claims with all 7 AAP categories", () => {
    const full = {
      agent: {
        name: "Claude Code",
        model: "claude-opus-4-6",
        runtime: "claude-code-cli",
        version: "1.2.3",
        capabilities: ["read", "write", "purchase"],
      },
      task: {
        description: "Purchase headphones from Amazon",
        id: "task_abc123",
      },
      capabilities: [{ action: "purchase", constraints: { max_amount: 500 } }],
      oversight: {
        requires_human_approval_for: ["purchase", "identity_access"],
        audit_level: "full" as const,
      },
      delegation: {
        depth: 1,
        chain: ["parent-agent-id"],
        parent_jti: "jti-xyz",
      },
      context: {
        network_zone: "corporate",
        geo: "US",
      },
      audit: {
        trace_id: "trace-xyz",
        session_id: "sess-abc",
      },
    };
    const result = parseAgentClaims(JSON.stringify(full));
    expect(result).toEqual(full);
  });

  it("returns null when agent.name is missing", () => {
    expect(
      parseAgentClaims(JSON.stringify({ agent: { model: "gpt-4" } }))
    ).toBeNull();
  });

  it("returns null when agent object is missing entirely", () => {
    expect(
      parseAgentClaims(JSON.stringify({ task: { description: "test" } }))
    ).toBeNull();
  });

  it("returns null for oversized agent.name (> 128 chars)", () => {
    expect(
      parseAgentClaims(JSON.stringify({ agent: { name: "x".repeat(129) } }))
    ).toBeNull();
  });

  it("returns null for oversized task.description (> 512 chars)", () => {
    expect(
      parseAgentClaims(
        JSON.stringify({
          agent: { name: "Test" },
          task: { description: "x".repeat(513) },
        })
      )
    ).toBeNull();
  });

  it("returns null for too many agent.capabilities (> 20)", () => {
    expect(
      parseAgentClaims(
        JSON.stringify({
          agent: {
            name: "Test",
            capabilities: Array.from({ length: 21 }, (_, i) => `cap${i}`),
          },
        })
      )
    ).toBeNull();
  });

  it("returns null for too many capabilities items (> 10)", () => {
    expect(
      parseAgentClaims(
        JSON.stringify({
          agent: { name: "Test" },
          capabilities: Array.from({ length: 11 }, (_, i) => ({
            action: `action${i}`,
          })),
        })
      )
    ).toBeNull();
  });

  it("strips extra unknown fields", () => {
    const result = parseAgentClaims(
      JSON.stringify({
        agent: { name: "Test", unknown_field: "evil" },
        evil_root: true,
      })
    );
    expect(result).toEqual({ agent: { name: "Test" } });
    expect((result as Record<string, unknown>).evil_root).toBeUndefined();
  });

  it("returns null for non-JSON input", () => {
    expect(parseAgentClaims("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAgentClaims("")).toBeNull();
  });

  it("returns null for empty agent.name", () => {
    expect(
      parseAgentClaims(JSON.stringify({ agent: { name: "" } }))
    ).toBeNull();
  });

  it("handles __proto__ injection safely", () => {
    const malicious = '{"agent":{"name":"test"},"__proto__":{"admin":true}}';
    const result = parseAgentClaims(malicious);
    expect(result).toEqual({ agent: { name: "test" } });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("handles constructor injection safely", () => {
    const result = parseAgentClaims(
      JSON.stringify({
        agent: { name: "test" },
        constructor: { prototype: { admin: true } },
      })
    );
    expect(result).toEqual({ agent: { name: "test" } });
  });
});

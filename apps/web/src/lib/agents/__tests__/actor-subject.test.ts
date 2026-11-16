import { describe, expect, it } from "vitest";

import { resolveAgentSub } from "@/lib/agents/actor-subject";
import { pairwiseValue } from "@/lib/auth/oidc/pairwise";
import { db } from "@/lib/db/connection";
import { pairwiseSubjects } from "@/lib/db/schema/oauth-provider";

const SESSION_ID = "agent-session-1";

describe("resolveAgentSub", () => {
  it("is pairwise in the token's sector by default", async () => {
    const sub = await resolveAgentSub({
      client: { clientId: "agent-client" },
      sector: "client/agent-client https://mcp.example",
      sessionId: SESSION_ID,
    });

    expect(sub).toBe(
      await pairwiseValue("client/agent-client https://mcp.example", SESSION_ID)
    );
  });

  it("differs between the audiences of one client", async () => {
    const client = { clientId: "agent-client" };
    const mcp = await resolveAgentSub({
      client,
      sector: "client/agent-client https://mcp.example",
      sessionId: SESSION_ID,
    });
    const wallet = await resolveAgentSub({
      client,
      sector: "client/agent-client urn:zentity:wallet:test",
      sessionId: SESSION_ID,
    });
    const opaque = await resolveAgentSub({
      client,
      sector: "client/agent-client",
      sessionId: SESSION_ID,
    });

    expect(new Set([mcp, wallet, opaque, SESSION_ID]).size).toBe(4);
  });

  it("names the session for a client an administrator made public", async () => {
    const sub = await resolveAgentSub({
      client: {
        clientId: "agent-client",
        metadata: JSON.stringify({ agent_subject_type: "public" }),
      },
      sector: "client/agent-client",
      sessionId: SESSION_ID,
    });

    expect(sub).toBe(SESSION_ID);
  });

  it("keeps the pairwise default for malformed metadata", async () => {
    const sub = await resolveAgentSub({
      client: { clientId: "agent-client", metadata: "{not json" },
      sector: "client/agent-client",
      sessionId: SESSION_ID,
    });

    expect(sub).not.toBe(SESSION_ID);
  });

  it("writes nothing that maps the value back to the session", async () => {
    await db.delete(pairwiseSubjects).run();

    await resolveAgentSub({
      client: { clientId: "agent-client" },
      sector: "client/agent-client",
      sessionId: SESSION_ID,
    });

    expect(await db.select().from(pairwiseSubjects).all()).toEqual([]);
  });
});

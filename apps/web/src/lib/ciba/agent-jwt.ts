import { eq, lt } from "drizzle-orm";
import { importJWK, jwtVerify } from "jose";

import { computeSessionState } from "@/lib/ciba/agent-lifecycle";
import { db } from "@/lib/db/connection";
import { agentSessions, usedAgentAssertionJtis } from "@/lib/db/schema/agent";

interface AgentAssertionResult {
  exp: number;
  hostId: string;
  jti: string;
  sessionId: string;
  taskDescriptionHash?: string | undefined;
  taskId?: string | undefined;
}

function agentAssertionReplayKey(sessionId: string, jti: string): string {
  return `${sessionId}:${jti}`;
}

export async function cleanupExpiredAgentAssertionJtis(): Promise<void> {
  try {
    await db
      .delete(usedAgentAssertionJtis)
      .where(lt(usedAgentAssertionJtis.expiresAt, new Date()))
      .run();
  } catch {
    // Non-critical — stale rows are harmless.
  }
}

export async function verifyAgentAssertion(
  jwt: string
): Promise<AgentAssertionResult | null> {
  try {
    const payloadB64 = jwt.split(".")[1];
    if (!payloadB64) {
      return null;
    }

    const rawPayload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8")
    ) as { iss?: string };
    const sessionId = rawPayload.iss;
    if (!sessionId) {
      return null;
    }

    const session = await db
      .select({
        publicKey: agentSessions.publicKey,
        status: agentSessions.status,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1)
      .get();
    if (!session || session.status !== "active") {
      return null;
    }

    const publicKey = await importJWK(JSON.parse(session.publicKey), "EdDSA");
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, {
      algorithms: ["EdDSA"],
      issuer: sessionId,
    });
    if (protectedHeader.typ !== "agent-assertion+jwt") {
      return null;
    }

    const lifecycle = await computeSessionState(sessionId);
    if (lifecycle !== "active") {
      return null;
    }

    const jti = payload.jti;
    const exp = payload.exp;
    if (typeof jti !== "string" || typeof exp !== "number") {
      return null;
    }

    return {
      exp,
      sessionId,
      hostId: (payload.host_id as string) ?? "",
      jti,
      taskId: payload.task_id as string | undefined,
      taskDescriptionHash: payload.task_hash as string | undefined,
    };
  } catch {
    return null;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildAgentAssertionReplayKey(
  sessionId: string,
  jti: string
): string {
  return agentAssertionReplayKey(sessionId, jti);
}

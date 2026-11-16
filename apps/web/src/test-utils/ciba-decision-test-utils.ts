import type { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import { auth } from "@/lib/auth/auth-config";
import { db } from "@/lib/db/connection";
import { cibaApprovals, cibaRequests } from "@/lib/db/schema/ciba";
import { createTestSession } from "@/test-utils/db-test-utils";

const AUTH_BASE = "http://localhost:3000/api/auth";

/** A signed-in browser for the approval endpoints. */
export interface TestApprover {
  cookie: string;
  sessionId: string;
}

export async function signInApprover(
  userId: string,
  authContextId?: string
): Promise<TestApprover> {
  const { sessionId, token } = await createTestSession(userId, authContextId);
  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  return {
    cookie: `better-auth.session_token=${token}.${signature}`,
    sessionId,
  };
}

async function postJson(
  path: string,
  approver: TestApprover,
  body: Record<string, unknown>
) {
  const response = await auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: approver.cookie },
      body: JSON.stringify(body),
    })
  );
  return {
    status: response.status,
    json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

export function postDecision(
  approver: TestApprover,
  body: {
    channel?: "email" | "page" | "push";
    decision?: "approved" | "denied";
    request_id: string;
    webauthn?: unknown;
  }
) {
  return postJson("/ciba/decision", approver, {
    decision: "approved",
    ...body,
  });
}

export function postDecisionOptions(approver: TestApprover, requestId: string) {
  return postJson("/ciba/decision/options", approver, {
    request_id: requestId,
  });
}

/**
 * Runs the approval page's passkey confirmation: fetches options for the
 * request and signs an assertion over their challenge.
 */
export async function confirmWithPasskey(
  approver: TestApprover,
  requestId: string,
  authenticator: TestAuthenticator,
  assertion: Omit<Parameters<TestAuthenticator["assert"]>[0], "challenge"> = {}
) {
  const options = await postDecisionOptions(approver, requestId);
  if (options.status !== 200) {
    throw new Error(
      `Decision options answered ${options.status}: ${JSON.stringify(options.json)}`
    );
  }
  return authenticator.assert({
    ...assertion,
    challenge: options.json.challenge as string,
  });
}

export async function requestIdForAuthReqId(
  authReqIdHash: string
): Promise<string> {
  const row = await db
    .select({ id: cibaRequests.id })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqIdHash))
    .get();
  if (!row) {
    throw new Error("Unknown CIBA request");
  }
  return row.id;
}

export async function requestStatus(requestId: string) {
  const row = await db
    .select({ status: cibaRequests.status })
    .from(cibaRequests)
    .where(eq(cibaRequests.id, requestId))
    .get();
  return row?.status;
}

export function decisionRecord(requestId: string) {
  return db
    .select()
    .from(cibaApprovals)
    .where(eq(cibaApprovals.requestId, requestId))
    .get();
}

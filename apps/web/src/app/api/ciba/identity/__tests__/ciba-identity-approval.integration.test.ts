import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import {
  confirmWithPasskey,
  decisionRecord,
  postDecision,
  requestStatus,
  signInApprover,
  type TestApprover,
} from "@/test-utils/ciba-decision-test-utils";
import {
  createTestCibaRequest,
  createTestUser,
  resetDatabase,
} from "@/test-utils/db-test-utils";
import { TestAuthenticator } from "@/test-utils/webauthn-test-utils";

import { POST as intentRoute } from "../intent/route";
import { POST as stageRoute } from "../stage/route";

const CLIENT_ID = "identity-approval-agent";
const SCOPE = "openid identity.name";

async function postRoute(
  route: (request: Request) => Promise<Response>,
  path: string,
  approver: TestApprover,
  body: unknown
) {
  const response = await route(
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: approver.cookie },
      body: JSON.stringify(body),
    })
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

/** What the approval page does after the vault opens. */
async function stageIdentity(approver: TestApprover, requestId: string) {
  const intent = await postRoute(
    intentRoute,
    "/api/ciba/identity/intent",
    approver,
    { request_id: requestId, scopes: ["identity.name"] }
  );
  if (intent.status !== 200) {
    throw new Error(`Intent answered ${intent.status}`);
  }
  const stage = await postRoute(
    stageRoute,
    "/api/ciba/identity/stage",
    approver,
    {
      request_id: requestId,
      scopes: ["identity.name"],
      identity: { given_name: "Ada", family_name: "Lovelace" },
      intent_token: intent.json.intent_token,
    }
  );
  if (stage.status !== 200 || stage.json.staged !== true) {
    throw new Error(`Stage answered ${stage.status}`);
  }
}

describe("CIBA approval of identity scopes", () => {
  let userId: string;
  let approver: TestApprover;
  let requestId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = await createTestUser();
    await db
      .insert(oauthClients)
      .values({
        clientId: CLIENT_ID,
        name: "Identity Approval Agent",
        redirectUris: JSON.stringify(["http://localhost/callback"]),
        grantTypes: JSON.stringify(["urn:openid:params:grant-type:ciba"]),
        tokenEndpointAuthMethod: "none",
      })
      .run();
    approver = await signInApprover(userId);
    ({ requestId } = await createTestCibaRequest({
      clientId: CLIENT_ID,
      userId,
      scope: SCOPE,
      bindingMessage: "Share your name",
    }));
  });

  // R11: identity is released only through the page.
  it("refuses an approval with no staged release", async () => {
    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(403);
    expect(response.json.error).toBe("vault_unlock_required");
    expect(await requestStatus(requestId)).toBe("pending");
  });

  // R12: without a passkey the session ceremony is the residual (I5).
  it("approves with the session for a user without a passkey", async () => {
    await stageIdentity(approver, requestId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(200);
    expect(await decisionRecord(requestId)).toEqual(
      expect.objectContaining({
        approvalMethod: "session",
        approvalChannel: "page",
      })
    );
  });

  // R10 and R12: a staged release does not prove a vault unlock.
  it("asks a passkey user to confirm even after the release is staged", async () => {
    await new TestAuthenticator().register(userId);
    await stageIdentity(approver, requestId);

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
    });

    expect(response.status).toBe(403);
    expect(response.json).toEqual(
      expect.objectContaining({
        error: "insufficient_user_authentication",
        approval_requirement: "user_verification",
      })
    );
    expect(await requestStatus(requestId)).toBe("pending");
  });

  // R10: a password vault unlock plus a standalone assertion approves.
  it("records user verification for a standalone passkey assertion", async () => {
    const authenticator = await new TestAuthenticator().register(userId);
    await stageIdentity(approver, requestId);
    const webauthn = await confirmWithPasskey(
      approver,
      requestId,
      authenticator
    );

    const response = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
      webauthn,
    });

    expect(response.status).toBe(200);
    expect(await decisionRecord(requestId)).toEqual(
      expect.objectContaining({
        approvalMethod: "user_verification",
        approvalChannel: "page",
      })
    );
  });

  // R19: the challenge survives a refusal on a cheaper check.
  it("checks the staged release before it spends the passkey challenge", async () => {
    const authenticator = await new TestAuthenticator().register(userId);
    const webauthn = await confirmWithPasskey(
      approver,
      requestId,
      authenticator
    );

    const early = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
      webauthn,
    });
    expect(early.status).toBe(403);
    expect(early.json.error).toBe("vault_unlock_required");

    await stageIdentity(approver, requestId);
    const approved = await postDecision(approver, {
      request_id: requestId,
      channel: "page",
      webauthn,
    });
    expect(approved.status).toBe(200);
  });
});

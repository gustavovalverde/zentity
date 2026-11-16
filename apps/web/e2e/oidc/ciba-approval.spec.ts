import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { decodeJwt } from "jose";

import { createPasswordVaultUser } from "../helpers/vault-user";
import {
  addPrfAuthenticator,
  registerPasskeyForUser,
} from "../helpers/virtual-authenticator";
import {
  createDpopBinding,
  findCibaRequestId,
  registerCibaClient,
  sendDpopRequest,
} from "./oidc-helpers";

const BASE_URL = (
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
const AUTH_BASE_URL = `${BASE_URL}/api/auth`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth2/token`;
const CIBA_GRANT_TYPE = "urn:openid:params:grant-type:ciba";

const PAYMENT_ENTRY = {
  type: "payment_authorization",
  chain: { namespace: "zcash", reference: "test" },
  recipient: "zcash:test:utest1qq0",
  amount: { currency: "ZEC", value: "1000", unit: "base" },
  payment_id: "pay_e2e_approval",
  intent_hash: `v1:sha256:${"A".repeat(43)}`,
  expires_at: { kind: "block_height", value: 4_056_276 },
};

async function signedInUserId(page: Page): Promise<string> {
  const session = (await (
    await page.request.get(`${AUTH_BASE_URL}/get-session`)
  ).json()) as { user?: { id?: string } };
  if (!session.user?.id) {
    throw new Error("The page has no signed-in user");
  }
  return session.user.id;
}

async function requestApproval(
  request: APIRequestContext,
  input: {
    authorizationDetails?: unknown[];
    clientId: string;
    scope: string;
    userId: string;
  }
) {
  const response = await request.post(`${AUTH_BASE_URL}/oauth2/bc-authorize`, {
    form: {
      client_id: input.clientId,
      login_hint: input.userId,
      scope: input.scope,
      binding_message: "Approval ceremony E2E",
      ...(input.authorizationDetails
        ? { authorization_details: JSON.stringify(input.authorizationDetails) }
        : {}),
    },
    headers: { Origin: BASE_URL },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { auth_req_id } = (await response.json()) as { auth_req_id: string };
  return {
    authReqId: auth_req_id,
    requestId: await findCibaRequestId(auth_req_id),
  };
}

async function pollToken(
  request: APIRequestContext,
  input: { authReqId: string; clientId: string }
) {
  const binding = await createDpopBinding();
  const response = await sendDpopRequest(
    binding,
    { method: "POST", url: TOKEN_URL },
    (proof) =>
      request.post(TOKEN_URL, {
        form: {
          grant_type: CIBA_GRANT_TYPE,
          auth_req_id: input.authReqId,
          client_id: input.clientId,
        },
        headers: { Origin: BASE_URL, DPoP: proof },
      })
  );
  return {
    status: response.status(),
    json: (await response.json()) as Record<string, unknown>,
  };
}

test.describe("CIBA approval ceremony", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(180_000);

  test("approves an identity request with one user-verified passkey ceremony", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const { password } = await createPasswordVaultUser(page, {
      firstName: "Ada",
    });
    await registerPasskeyForUser(page, password);
    const userId = await signedInUserId(page);
    const clientId = await registerCibaClient(request, "ceremony-e2e");
    const { authReqId, requestId } = await requestApproval(request, {
      clientId,
      scope: "openid identity.name",
      userId,
    });

    await page.goto(`/approve/${requestId}`);
    const assertionsBefore = await authenticator.signCount();
    await page.getByRole("button", { name: "Approve with passkey" }).click();
    await expect(page.getByText("Request Approved")).toBeVisible({
      timeout: 30_000,
    });
    expect(await authenticator.signCount()).toBe(assertionsBefore + 1);

    const token = await pollToken(request, { authReqId, clientId });
    expect(token.status, JSON.stringify(token.json)).toBe(200);
    expect(token.json.oversight).toEqual({
      method: "user_verification",
      approved_at: expect.any(Number),
    });
    const idToken = decodeJwt(token.json.id_token as string);
    expect(idToken.amr).toEqual(["pop", "user", "mfa"]);
  });

  test("leaves the request pending when the authenticator does not verify the user", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const authenticator = await addPrfAuthenticator(page);
    const { password } = await createPasswordVaultUser(page, {
      firstName: "Ada",
    });
    await registerPasskeyForUser(page, password);
    const userId = await signedInUserId(page);
    const clientId = await registerCibaClient(request, "ceremony-e2e");
    const { authReqId, requestId } = await requestApproval(request, {
      clientId,
      scope: "openid identity.name",
      userId,
    });

    await authenticator.setUserVerified(false);
    await page.goto(`/approve/${requestId}`);
    await page.getByRole("button", { name: "Approve with passkey" }).click();

    await expect(page.getByRole("alert").last()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Request Approved")).toHaveCount(0);
    const token = await pollToken(request, { authReqId, clientId });
    expect(token.json.error).toBe("authorization_pending");
  });

  test("approves a compliance request with a page click as a session approval", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await createPasswordVaultUser(page, { firstName: "Ada" });
    const userId = await signedInUserId(page);
    const clientId = await registerCibaClient(request, "ceremony-e2e");
    const { authReqId, requestId } = await requestApproval(request, {
      clientId,
      scope: "openid compliance:read",
      userId,
    });

    await page.goto(`/approve/${requestId}`);
    await expect(page.getByText("compliance status")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Request Approved")).toBeVisible({
      timeout: 30_000,
    });

    const token = await pollToken(request, { authReqId, clientId });
    expect(token.status, JSON.stringify(token.json)).toBe(200);
    expect(token.json.oversight).toEqual(
      expect.objectContaining({ method: "session" })
    );
  });

  test("asks a user without a passkey to add one and still lets them deny", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await createPasswordVaultUser(page, { firstName: "Ada" });
    const userId = await signedInUserId(page);
    // A payment client declares the RAR type it requests (RFC 9396 §10).
    const clientId = await registerCibaClient(request, "ceremony-e2e", {
      authorization_details_types: ["payment_authorization"],
    });
    const { authReqId, requestId } = await requestApproval(request, {
      clientId,
      scope: "openid",
      authorizationDetails: [PAYMENT_ENTRY],
      userId,
    });

    await page.goto(`/approve/${requestId}`);
    await expect(
      page.getByText("Add a passkey to approve this request.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve with passkey" })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Deny" }).click();
    await expect(page.getByText("Request Denied")).toBeVisible({
      timeout: 30_000,
    });

    const token = await pollToken(request, { authReqId, clientId });
    expect(token.json.error).toBe("access_denied");
  });
});

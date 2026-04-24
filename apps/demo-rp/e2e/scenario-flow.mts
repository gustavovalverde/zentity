import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type APIRequestContext,
  expect,
  type Page,
  request as playwrightRequest,
} from "@playwright/test";

import {
  createCredentialOffer,
  createIssuerSession,
} from "../../web/e2e/oidc/oidc-helpers";

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const webE2eDir = join(currentDir, "..", "..", "web", "e2e");
const webAuthStatePath = join(webE2eDir, ".auth", "user.json");
const webAuthSeedPath = join(webE2eDir, ".auth", "seed.json");
const issuerBaseURL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const demoRpBaseURL =
  process.env.PLAYWRIGHT_DEMO_RP_BASE_URL ?? "http://localhost:3102";
const veripassWalletClientId =
  process.env.OIDC4VCI_WALLET_CLIENT_ID ?? "zentity-wallet";
const TRAILING_SLASH_RE = /\/+$/;
const SIGN_IN_BUTTON_TIMEOUT_MS = 60_000;

interface SignInOptions {
  path: string;
  signInButtonName: RegExp | string;
}

interface StepUpOptions {
  actionButtonName: RegExp | string;
  path: string;
}

interface AuthSeed {
  password: string;
}

function matchesDemoRpPath(url: URL, path: string): boolean {
  return (
    url.origin === demoRpBaseURL.replace(TRAILING_SLASH_RE, "") &&
    url.pathname === path
  );
}

function readAuthSeed(): AuthSeed {
  if (!existsSync(webAuthSeedPath)) {
    throw new Error(`Missing Playwright auth seed at ${webAuthSeedPath}`);
  }
  return JSON.parse(readFileSync(webAuthSeedPath, "utf8")) as AuthSeed;
}

async function maybeUnlockVault(page: Page) {
  const passwordField = page.getByPlaceholder("Enter your password");
  if (!(await passwordField.isVisible().catch(() => false))) {
    return;
  }

  await passwordField.fill(readAuthSeed().password);
  await page.getByRole("button", { name: "Unlock" }).click();
}

export async function registerScenario(
  request: APIRequestContext,
  scenarioId: string
) {
  const statusResponse = await request.get(
    `/api/dcr?scenarioId=${encodeURIComponent(scenarioId)}`
  );
  expect(statusResponse.ok()).toBeTruthy();
  const statusBody = (await statusResponse.json()) as { registered?: boolean };
  if (statusBody.registered) {
    return;
  }

  const registerResponse = await request.post("/api/dcr", {
    data: { scenarioId },
  });
  if (!registerResponse.ok()) {
    const body = await registerResponse.text();
    throw new Error(
      `DCR registration failed for ${scenarioId} (${registerResponse.status()}): ${body}`
    );
  }
}

export async function signInToScenario(page: Page, options: SignInOptions) {
  await page.goto(options.path);
  const signInButton = page.getByRole("button", {
    name: options.signInButtonName,
  });
  await expect(signInButton).toBeEnabled({
    timeout: SIGN_IN_BUTTON_TIMEOUT_MS,
  });
  await signInButton.click();
  await completeConsent(page, options.path);
}

export async function completeConsent(page: Page, path: string) {
  const allowButton = page.getByRole("button", { name: "Allow" });
  await allowButton.waitFor({ state: "visible", timeout: 60_000 });
  await page
    .locator('[data-consent-hydrated="true"]')
    .waitFor({ state: "attached", timeout: 60_000 });
  await maybeUnlockVault(page);
  await expect(allowButton).toBeEnabled({ timeout: 30_000 });
  await allowButton.click();
  await page.waitForURL((url: URL) => matchesDemoRpPath(url, path), {
    timeout: 60_000,
  });
}

export async function completeStepUp(page: Page, options: StepUpOptions) {
  await page.getByRole("button", { name: options.actionButtonName }).click();
  await completeConsent(page, options.path);
}

export async function waitForAetherAuthorization(page: Page) {
  const authorizeResponse = await page.waitForResponse(
    (response: import("@playwright/test").Response) =>
      response.url() === `${demoRpBaseURL}/api/ciba` &&
      response.request().method() === "POST" &&
      response.request().postData()?.includes('"action":"authorize"') === true,
    {
      timeout: 30_000,
    }
  );

  expect(authorizeResponse.ok()).toBeTruthy();
  const body = (await authorizeResponse.json()) as { auth_req_id?: string };
  if (!body.auth_req_id) {
    throw new Error("CIBA authorize response did not include auth_req_id");
  }
  return body.auth_req_id;
}

export async function approveCibaRequest(authReqId: string) {
  const approvalRequest = await playwrightRequest.newContext({
    baseURL: issuerBaseURL,
    storageState: webAuthStatePath,
    extraHTTPHeaders: {
      Origin: issuerBaseURL,
      "Content-Type": "application/json",
    },
  });

  try {
    const response = await approvalRequest.post("/api/auth/ciba/authorize", {
      data: { auth_req_id: authReqId },
    });
    expect(response.ok()).toBeTruthy();
  } finally {
    await approvalRequest.dispose();
  }
}

export async function importVeripassCredential(
  page: Page,
  request: APIRequestContext
) {
  const issuerSession = await createIssuerSession(request);
  const { offer } = await createCredentialOffer(request, {
    cookieHeader: issuerSession.cookieHeader,
    // The demo wallet is a fixed public client; issue the offer for that client
    // so the wallet import path matches the real integration contract.
    clientId: veripassWalletClientId,
    userId: issuerSession.userId,
    credentialConfigurationId: "identity_verification",
  });

  const offerUri = `openid-credential-offer://?credential_offer=${encodeURIComponent(
    JSON.stringify(offer)
  )}`;

  await page.getByLabel("Credential Offer").fill(offerUri);
  await page.getByRole("button", { name: "Import Credential" }).click();
  await expect(page.getByText("Credential Claims")).toBeVisible({
    timeout: 30_000,
  });
}

export async function presentCredential(
  page: Page,
  verifierName: RegExp | string
) {
  await page.getByRole("button", { name: verifierName }).click();
  await expect(
    page.getByRole("button", { name: "Present Credential" })
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Present Credential" }).click();
  await expect(page.getByText("Verification Successful")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Back to Wallet" }).click();
  await expect(page.getByText("Present to a Verifier")).toBeVisible({
    timeout: 15_000,
  });
}

import { expect, type Page, test } from "@playwright/test";

import { completeConsent, registerScenario } from "./scenario-flow.mts";

const issuerBaseURL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const demoRpBaseURL =
  process.env.PLAYWRIGHT_DEMO_RP_BASE_URL ?? "http://localhost:3102";
const DASHBOARD_URL_PATTERN = /\/dashboard/;
const EMAIL_ADDRESS_PATTERN = /Email Address \(optional\)/i;
const PASSWORD_OPTION_PATTERN = /Password Use a secure password/i;

test.use({ storageState: { cookies: [], origins: [] } });

async function expectAuthenticatedEmail(page: Page, expectedEmail: string) {
  const sessionEmail = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      cache: "no-store",
    });
    const session = (await response.json()) as { user?: { email?: string } };
    return session.user?.email;
  });
  expect(sessionEmail).toBe(expectedEmail);
}

test("a newly registered password user keeps the same identity across issuer and RP journeys", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `journey-${unique}@example.com`;
  const password = `Journey.${unique}!Q7x`;

  await page.goto(`${issuerBaseURL}/sign-up?fresh=1`, {
    waitUntil: "domcontentloaded",
  });
  const passwordOption = page.getByRole("button", {
    name: PASSWORD_OPTION_PATTERN,
  });
  await expect(passwordOption).toBeVisible();
  const passwordInput = page.getByLabel("Password", { exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await passwordOption.click();
    if (await passwordInput.isVisible().catch(() => false)) {
      break;
    }
    await page.waitForTimeout(250);
  }
  await expect(passwordInput).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox", { name: EMAIL_ADDRESS_PATTERN }).fill(email);
  await expect(
    page.getByRole("textbox", { name: EMAIL_ADDRESS_PATTERN })
  ).toHaveValue(email);
  await passwordInput.fill(password);
  const confirmation = page.getByLabel("Confirm Password");
  await confirmation.fill(password);
  await confirmation.blur();
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(
    page.getByRole("heading", { name: "Check your inbox" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("link", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
  await expectAuthenticatedEmail(page, email);
  await expect(page.getByText("Email not verified")).toBeVisible();
  await expect(page.getByText("No email address")).toHaveCount(0);

  await Promise.all([
    page.waitForURL(
      (url) => url.origin === issuerBaseURL && url.pathname === "/"
    ),
    page.getByRole("button", { name: "Sign Out" }).click(),
  ]);
  await page.goto(`${issuerBaseURL}/sign-in`);
  await page.getByLabel("Email or Recovery ID").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
  await expectAuthenticatedEmail(page, email);
  await expect(page.getByText("Email not verified")).toBeVisible();

  await registerScenario(request, "bank");
  await page.goto(`${demoRpBaseURL}/bank`);
  await page.getByRole("button", { name: "Member Access" }).click();
  await completeConsent(page, "/bank");
  await expect(
    page.getByText("Complete verification to activate your account")
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(`${demoRpBaseURL}/bank`, { timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "Member Access" })
  ).toBeVisible();
  const issuerSessionResponse = await page
    .context()
    .request.get(`${issuerBaseURL}/api/auth/get-session`);
  expect(issuerSessionResponse.ok()).toBe(true);
  expect(await issuerSessionResponse.json()).toBeNull();

  await page.goto(`${issuerBaseURL}/sign-in`);
  await page.getByLabel("Email or Recovery ID").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 60_000 });
  await expectAuthenticatedEmail(page, email);

  await registerScenario(request, "exchange");
  await page.goto(`${demoRpBaseURL}/exchange`);
  await page.getByRole("button", { name: "Connect with Zentity" }).click();
  await expect(
    page.getByText(
      "Identity verification required. This service requires a higher assurance level than your current account provides."
    )
  ).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(`${demoRpBaseURL}/exchange`);

  await registerScenario(request, "wine");
  await page.goto(`${demoRpBaseURL}/wine`);
  await page.getByRole("button", { name: "Verify Age Anonymously" }).click();
  await completeConsent(page, "/wine");
  await expect(
    page.getByText(
      "Your Zentity account does not have an age-verification proof yet."
    )
  ).toBeVisible();
  await expect(page.getByText("Verified 18+")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to Cellar" })).toHaveCount(
    0
  );
});

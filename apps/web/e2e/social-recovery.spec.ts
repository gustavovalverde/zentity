import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const SEED_PATH = fileURLToPath(new URL("./.auth/seed.json", import.meta.url));
const APPROVAL_TEXT_RE = /Approval recorded|Recovery approved/;

function getSeedEmail(): string {
  if (process.env.E2E_EMAIL) {
    return process.env.E2E_EMAIL;
  }
  try {
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw) as { email?: string };
    if (parsed.email) {
      return parsed.email;
    }
  } catch {
    // Fall through.
  }
  throw new Error("E2E seed email not found.");
}

test.describe("Social Recovery", () => {
  test("starts guardian recovery flow", async ({ page }) => {
    test.setTimeout(120_000);
    const email = getSeedEmail();
    const guardianEmails = [
      "guardian.one@example.com",
      "guardian.two@example.com",
    ];

    const configLogPromise = page.waitForEvent("console", {
      timeout: 60_000,
      predicate: (message) =>
        message.text().includes("[trpc] >> query recovery.config"),
    });
    await page.goto("/dashboard/settings", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await configLogPromise;

    const enableButton = page.getByRole("button", { name: "Enable recovery" });
    await enableButton.scrollIntoViewIfNeeded();
    await enableButton.waitFor({ state: "visible", timeout: 60_000 });
    const setupResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/trpc/recovery.setup") &&
        response.request().method() === "POST",
      { timeout: 60_000 }
    );
    await enableButton.click();
    const setupResponse = await setupResponsePromise;
    if (!setupResponse.ok()) {
      throw new Error(
        `recovery.setup failed: ${setupResponse.status()} ${await setupResponse.text()}`
      );
    }
    await expect(
      page.getByRole("button", { name: "Add guardian" })
    ).toBeVisible({
      timeout: 120_000,
    });

    for (const guardianEmail of guardianEmails) {
      await page.getByPlaceholder("guardian@example.com").fill(guardianEmail);
      await page.getByRole("button", { name: "Add guardian" }).click();
      await expect(page.getByText(guardianEmail)).toBeVisible({
        timeout: 30_000,
      });
    }

    await page.context().clearCookies();

    await page.goto("/recover-social", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle");

    await page.fill('input[type="email"]', email);
    await page.getByRole("button", { name: "Start guardian recovery" }).click();
    await expect(
      page.getByText("Step 2 of 3 · Guardian approvals")
    ).toBeVisible({
      timeout: 120_000,
    });

    const showLinks = page.getByRole("button", {
      name: "Show manual links",
    });
    if (await showLinks.count()) {
      await showLinks.click();
    }

    const approvalInputs = page.locator("input[data-guardian-link]");
    await expect(approvalInputs.first()).toBeVisible({ timeout: 120_000 });

    const firstLink = await approvalInputs.nth(0).inputValue();
    const secondLink = await approvalInputs.nth(1).inputValue();

    const guardianPage = await page.context().newPage();
    await guardianPage.goto(firstLink, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await guardianPage
      .getByRole("button", { name: "Approve recovery" })
      .click();
    await expect(guardianPage.getByText(APPROVAL_TEXT_RE)).toBeVisible({
      timeout: 30_000,
    });

    await guardianPage.goto(secondLink, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await guardianPage
      .getByRole("button", { name: "Approve recovery" })
      .click();
    await expect(guardianPage.getByText(APPROVAL_TEXT_RE)).toBeVisible({
      timeout: 30_000,
    });

    await guardianPage.close();

    await expect(
      page.getByRole("button", { name: "Register new passkey" })
    ).toBeVisible({ timeout: 120_000 });
  });
});

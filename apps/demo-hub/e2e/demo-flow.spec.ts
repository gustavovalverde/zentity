import { expect, test } from "@playwright/test";

test.describe("demo hub exchange flow", () => {
  test("issues credential and verifies presentation", async ({ page, context }) => {
    await page.goto("/exchange-kyc");

    await page.getByTestId("seed-demo").click();
    await expect(page.getByText("Level: full")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("create-offer").click();
    const [walletOfferPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("open-wallet-offer").click(),
    ]);
    await walletOfferPage.waitForLoadState("domcontentloaded");
    await walletOfferPage.waitForURL(/offerId=/);
    await expect(walletOfferPage.getByTestId("issue-credential")).toBeEnabled({
      timeout: 30_000,
    });
    await walletOfferPage.getByTestId("issue-credential").click();
    await expect(
      walletOfferPage.getByTestId("stored-credential")
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("create-request").click();
    const requestUrl = await page
      .getByTestId("open-wallet-request")
      .getAttribute("href");
    if (!requestUrl) {
      throw new Error("Missing request URL");
    }
    await walletOfferPage.goto(requestUrl);
    await walletOfferPage.waitForLoadState("domcontentloaded");
    await walletOfferPage.waitForURL(/requestId=/);
    await expect(
      walletOfferPage.getByTestId("presentation-request")
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      walletOfferPage.getByTestId("submit-presentation")
    ).toBeEnabled({ timeout: 30_000 });
    await walletOfferPage.getByTestId("submit-presentation").click();
    await expect(
      walletOfferPage.getByText("Presentation accepted.", { exact: false })
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("refresh-request").click();
    await expect(page.getByText("Request verified")).toBeVisible({
      timeout: 30_000,
    });
  });
});

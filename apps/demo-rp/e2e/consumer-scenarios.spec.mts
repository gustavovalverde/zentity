import { expect, test } from "@playwright/test";

import {
  approveCibaRequest,
  completeStepUp,
  registerScenario,
  signInToScenario,
  waitForAetherAuthorization,
} from "./scenario-flow.mts";

const TRADE_BUTTON_NAME_RE = /trade/i;
const WIRELESS_HEADPHONES_BUTTON_NAME_RE = /Wireless headphones/i;

test.describe("demo-rp consumer scenarios", () => {
  test("bank completes sign-in and step-up account opening", async ({
    page,
    request,
  }) => {
    await registerScenario(request, "bank");
    await signInToScenario(page, {
      path: "/bank",
      signInButtonName: "Member Access",
    });

    await completeStepUp(page, {
      actionButtonName: "Open Account",
      path: "/bank",
    });

    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true })
    ).toBeVisible();
    await expect(page.getByText("Welcome back")).toBeVisible();
  });

  test("exchange completes sign-in and nationality step-up", async ({
    page,
    request,
  }) => {
    await registerScenario(request, "exchange");
    await signInToScenario(page, {
      path: "/exchange",
      signInButtonName: "Connect with Zentity",
    });

    await page.getByRole("button", { name: TRADE_BUTTON_NAME_RE }).click();
    await completeStepUp(page, {
      actionButtonName: "Verify to Start Trading",
      path: "/exchange",
    });

    await expect(page.getByText("Lv.2 VERIFIED")).toBeVisible();
    await expect(page.getByText("Nationality")).toBeVisible();
  });

  test("wine completes age gate, checkout step-up, and order placement", async ({
    page,
    request,
  }) => {
    await registerScenario(request, "wine");
    await signInToScenario(page, {
      path: "/wine",
      signInButtonName: "Verify Age Anonymously",
    });

    await page.getByRole("button", { name: "Add to Cellar" }).first().click();
    await page.getByRole("button", { name: "Your Cellar" }).click();
    await completeStepUp(page, {
      actionButtonName: "Verify Delivery Details to Checkout",
      path: "/wine",
    });

    await expect(page.getByText("Ship To")).toBeVisible();
    await page.getByRole("button", { name: "Place Order" }).click();
    await expect(page.getByText("Order Confirmed")).toBeVisible();
  });

  test("aether completes CIBA approval and purchase", async ({
    page,
    request,
  }) => {
    await registerScenario(request, "aether");
    await signInToScenario(page, {
      path: "/aether",
      signInButtonName: "Sign in with Zentity",
    });

    const authReqIdPromise = waitForAetherAuthorization(page);
    await page
      .getByRole("button", { name: WIRELESS_HEADPHONES_BUTTON_NAME_RE })
      .click();
    const authReqId = await authReqIdPromise;

    await approveCibaRequest(authReqId);

    await expect(page.getByText("Purchase Complete")).toBeVisible({
      timeout: 40_000,
    });
  });
});

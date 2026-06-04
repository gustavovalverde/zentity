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
const ZCASH_URI_RE = /^zcash:/;

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

  test("aether completes CIBA approval and renders zpay bridge", async ({
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

    // After CIBA approval, the bridge replaces the legacy "Purchase
    // Complete" stub because the headphones task is now `zpay`-enabled.
    // The bridge shows the ZIP-321 URI, a QR code, and a "Waiting for
    // your wallet" status row while the SSE stream stays open.
    await expect(page.getByText("ZIP-321 payment URI")).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText("Waiting for your wallet")).toBeVisible();

    // The URI itself should be a ZIP-321 zcash URI. The component
    // renders it inside a <code> element.
    const uriElement = page.locator("code", { hasText: ZCASH_URI_RE });
    await expect(uriElement).toBeVisible();

    // Confirm the SSE proxy route was actually hit by the browser.
    // The EventSource connection request is the deterministic proof
    // that the bridge wired up to the upstream events stream.
    const proxyRequest = await page.waitForRequest(
      (req: import("@playwright/test").Request) =>
        req.url().includes("/api/aether/payments/") &&
        req.url().endsWith("/events"),
      { timeout: 10_000 }
    );
    expect(proxyRequest.method()).toBe("GET");
  });
});

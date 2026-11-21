import { isDeepStrictEqual } from "node:util";

import { expect, test } from "@playwright/test";
import { PAYMENT_REQUIRED_HEADER } from "@zentity/sdk/rp";

import {
  approveCibaRequestWithPasskey,
  completeStepUp,
  readDemoSession,
  registerScenario,
  signInToScenario,
  signInToScenarioThroughApi,
  waitForAetherAuthorization,
} from "./scenario-flow.mts";
import {
  runX402Agent,
  signTestPayment,
  startMockFacilitator,
} from "./x402-agent.mts";

const TRADE_BUTTON_NAME_RE = /trade/i;
const WIRELESS_HEADPHONES_BUTTON_NAME_RE = /Wireless headphones/i;
const ZCASH_URI_RE = /^zcash:/;
const COMPACT_JWT_RE = /eyJ[A-Za-z0-9_-]+\./;
const demoRpBaseURL =
  process.env.PLAYWRIGHT_DEMO_RP_BASE_URL ?? "http://localhost:3102";

test.describe("demo-rp consumer scenarios", () => {
  test("provider claims stay isolated and available across sign-ins", async ({
    page,
    request,
  }) => {
    await registerScenario(request, "bank");
    await registerScenario(request, "exchange");
    await signInToScenario(page, {
      path: "/bank",
      signInButtonName: "Member Access",
    });

    await completeStepUp(page, {
      actionButtonName: "Open Account",
      path: "/bank",
    });

    const bankSession = await readDemoSession(page);
    expect(typeof bankSession?.user?.id).toBe("string");
    expect(bankSession?.user?.claims?.["zentity-bank"]?.name).toBeDefined();

    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true })
    ).toBeVisible();
    await expect(page.getByText("Welcome back")).toBeVisible();

    await signInToScenario(page, {
      path: "/exchange",
      signInButtonName: "Connect with Zentity",
    });

    await page.getByRole("button", { name: TRADE_BUTTON_NAME_RE }).click();
    await completeStepUp(page, {
      actionButtonName: "Verify to Start Trading",
      path: "/exchange",
    });

    await page.reload();
    await expect(page.getByText("Account Status")).toBeVisible();
    await expect(page.getByText("Lv.2 VERIFIED")).toBeVisible();
    await expect(page.getByText("Nationality")).toBeVisible();
    const sessionAfterExchange = await readDemoSession(page);
    const claims = sessionAfterExchange?.user?.claims;
    const bankClaimsPreserved = isDeepStrictEqual(
      claims?.["zentity-bank"],
      bankSession?.user?.claims?.["zentity-bank"]
    );
    expect(sessionAfterExchange?.user?.id).toBe(bankSession?.user?.id);
    expect(bankClaimsPreserved).toBe(true);
    expect(claims?.["zentity-exchange"]?.nationality).toBeDefined();
    expect(
      typeof claims?.["zentity-bank"]?.sub === "string" &&
        typeof claims?.["zentity-exchange"]?.sub === "string" &&
        claims["zentity-bank"].sub !== claims["zentity-exchange"].sub
    ).toBe(true);

    await page.goto("/bank");
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Welcome back")).toBeVisible();
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
    browser,
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

    // The bridge opens the payment-events stream as soon as it mounts after
    // approval, so the wait must be registered before approving.
    const eventsRequestPromise = page.waitForRequest(
      (req: import("@playwright/test").Request) =>
        req.url().includes("/api/aether/payments/") &&
        req.url().endsWith("/events"),
      { timeout: 60_000 }
    );

    // A manual payment approval needs a user-verified passkey assertion.
    await approveCibaRequestWithPasskey(browser, authReqId);

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
    const proxyRequest = await eventsRequestPromise;
    expect(proxyRequest.method()).toBe("GET");
  });

  test("x402 agent pays with a merchant-bound Proof-of-Human, and the browser journey settles", async ({
    browser,
    page,
    request,
  }) => {
    const facilitator = await startMockFacilitator();
    try {
      await registerScenario(request, "x402");
      await signInToScenarioThroughApi(page, "zentity-x402");

      // An agent for the signed-in user: the user approves a Proof-of-Human
      // for demo-rp on Zentity's page, and the agent's test wallet pays.
      const resourceUrl = `${demoRpBaseURL}/api/x402/access?resourceId=verified-identity`;
      const paid = await runX402Agent({
        url: resourceUrl,
        onPendingApproval: (authReqId) =>
          approveCibaRequestWithPasskey(
            browser,
            authReqId,
            `You proved to ${new URL(demoRpBaseURL).host} that your identity is verified. The agent can now continue.`
          ),
      });
      expect(paid.status, await paid.clone().text()).toBe(200);
      expect(await paid.json()).toMatchObject({
        access: "granted",
        poh: { identity: { strength_at_least: "documentary_full" } },
      });
      expect(facilitator.requests.map((entry) => entry.path)).toEqual([
        "/verify",
        "/settle",
      ]);
      // The facilitator never receives a Zentity token.
      expect(JSON.stringify(facilitator.requests)).not.toMatch(COMPACT_JWT_RE);

      // A resource that checks identity on-chain has no agent path, and the
      // agent stops before asking the user.
      await expect(
        runX402Agent({
          url: `${demoRpBaseURL}/api/x402/access?resourceId=regulated-finance`,
          onPendingApproval: () => {
            throw new Error("The agent asked for an approval it cannot use");
          },
        })
      ).rejects.toMatchObject({ code: "unsupported_resource" });

      // The browser journey: the merchant obtains the user's client-mode
      // token server side and settles the payment the wallet signed.
      const unpaid = await page.request.post("/api/x402/access", {
        data: { resourceId: "verified-identity" },
      });
      expect(unpaid.status()).toBe(402);
      const settled = await page.request.post("/api/x402/access", {
        data: { resourceId: "verified-identity" },
        headers: await signTestPayment(
          unpaid.headers()[PAYMENT_REQUIRED_HEADER.toLowerCase()] as string
        ),
      });
      expect(settled.status(), await settled.text()).toBe(200);
      expect(await settled.json()).toMatchObject({
        access: "granted",
        poh: { identity: { verified: true, strength: "documentary_full" } },
      });
    } finally {
      await facilitator.close();
    }
  });
});

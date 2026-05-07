import { expect, test } from "@playwright/test";

const DASHBOARD_URL_PATTERN = /\/dashboard/;
const LINK_BUTTON_PATTERN = /^Link World ID$/i;
const REMOVE_BUTTON_PATTERN = /^Remove$/i;
const RP_CONTEXT_URL_PATTERN = /\/api\/world-id\/rp-context$/;
const APP_ID_PATTERN = /^app_/;
const RP_ID_PATTERN = /^rp_/;
const ENVIRONMENT_PATTERN = /^(production|staging)$/;
const EXPECTED_ACTION = "zentity-link-human-signal";

test.describe("Dashboard - World ID linking", () => {
  test("opens IDKit widget after a successful rp-context request", async ({
    page,
  }) => {
    await page.goto("/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(page).toHaveURL(DASHBOARD_URL_PATTERN, { timeout: 30_000 });

    const linkButton = page.getByRole("button", { name: LINK_BUTTON_PATTERN });
    const removeButton = page.getByRole("button", {
      name: REMOVE_BUTTON_PATTERN,
    });

    const linkVisible = await linkButton
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(
      !linkVisible,
      "World ID is already linked for the seeded session; nothing to do."
    );

    const rpContextResponse = page.waitForResponse(
      (response) =>
        RP_CONTEXT_URL_PATTERN.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST"
    );
    await linkButton.first().click();

    const response = await rpContextResponse;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      action?: string;
      appId?: string;
      challengeId?: string;
      environment?: string;
      rpContext?: { rp_id?: string; signature?: string };
    };
    expect(body.action).toBe(EXPECTED_ACTION);
    expect(body.appId).toMatch(APP_ID_PATTERN);
    expect(body.challengeId).toEqual(expect.any(String));
    expect(body.environment).toMatch(ENVIRONMENT_PATTERN);
    expect(body.rpContext?.rp_id).toMatch(RP_ID_PATTERN);
    expect(typeof body.rpContext?.signature).toBe("string");

    const widgetMounted = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const start = Date.now();
          const tick = () => {
            const hasShadowRoot = Array.from(
              document.querySelectorAll("*")
            ).some((el) => Boolean(el.shadowRoot));
            if (hasShadowRoot) {
              resolve(true);
              return;
            }
            if (Date.now() - start > 8000) {
              resolve(false);
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        })
    );
    expect(widgetMounted).toBe(true);

    await expect(removeButton).toHaveCount(0);
  });
});

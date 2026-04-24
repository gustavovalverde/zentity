import { test } from "@playwright/test";

import {
  importVeripassCredential,
  presentCredential,
  registerScenario,
  signInToScenario,
} from "./scenario-flow.mts";

const BORDER_CONTROL_NAME_RE = /Border Control/i;
const BACKGROUND_CHECK_NAME_RE = /Background Check/i;
const AGE_RESTRICTED_VENUE_NAME_RE = /Age-Restricted Venue/i;
const FINANCIAL_INSTITUTION_NAME_RE = /Financial Institution/i;

async function openWalletAndImportCredential(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) {
  await registerScenario(request, "veripass");
  await signInToScenario(page, {
    path: "/veripass",
    signInButtonName: "Connect with Zentity",
  });
  await importVeripassCredential(page, request);
}

test.describe("veripass verifier scenarios", () => {
  test("border control presentation succeeds", async ({ page, request }) => {
    await openWalletAndImportCredential(page, request);
    await presentCredential(page, BORDER_CONTROL_NAME_RE);
  });

  test("background check presentation succeeds", async ({ page, request }) => {
    await openWalletAndImportCredential(page, request);
    await presentCredential(page, BACKGROUND_CHECK_NAME_RE);
  });

  test("age-restricted venue presentation succeeds", async ({
    page,
    request,
  }) => {
    await openWalletAndImportCredential(page, request);
    await presentCredential(page, AGE_RESTRICTED_VENUE_NAME_RE);
  });

  test("financial institution presentation succeeds", async ({
    page,
    request,
  }) => {
    await openWalletAndImportCredential(page, request);
    await presentCredential(page, FINANCIAL_INSTITUTION_NAME_RE);
  });
});

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@libsql/client";
import { expect } from "@playwright/test";
import { chromium, request } from "playwright";

const TRAILING_SLASHES = /\/+$/;

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

const issuerBaseUrl = normalizeBaseUrl(
  process.env.ZENTITY_URL ?? "http://localhost:3000"
);
const demoRpBaseUrl = normalizeBaseUrl(
  process.env.DEMO_RP_URL ?? "http://localhost:3102"
);
const issuerDbUrl =
  process.env.ZENTITY_SMOKE_DATABASE_URL ??
  process.env.TURSO_DATABASE_URL ??
  toFileUrl(path.join(currentDir, "..", ".data", "dev.db"));
const demoRpDbUrl =
  process.env.DEMO_RP_DATABASE_URL ??
  toFileUrl(
    path.join(currentDir, "..", "..", "demo-rp", ".data", "demo-rp.db")
  );
const demoRpDir = path.join(currentDir, "..", "..", "demo-rp");
const providerId = "aid";
const adminApiKey = process.env.ZENTITY_ADMIN_API_KEY;

function normalizeBaseUrl(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

function fail(message: string): never {
  throw new Error(message);
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function ensureEqual(
  actual: number | string,
  expected: number | string,
  message: string
): void {
  if (actual !== expected) {
    fail(`${message} (expected ${expected}, got ${actual})`);
  }
}

async function expectResponseStatus(
  response: Response | import("playwright").APIResponse,
  expectedStatus: number,
  label: string
): Promise<void> {
  const actualStatus =
    typeof response.status === "function" ? response.status() : response.status;

  if (actualStatus === expectedStatus) {
    return;
  }

  const body =
    typeof response.text === "function"
      ? await response.text().catch(() => "<unreadable body>")
      : "<body unavailable>";

  fail(`${label} (expected ${expectedStatus}, got ${actualStatus}): ${body}`);
}

function toFileUrl(filePath: string): string {
  return filePath.startsWith("file:") ? filePath : `file:${filePath}`;
}

function createDbClient(url: string) {
  const authToken =
    url === demoRpDbUrl
      ? process.env.DEMO_RP_DATABASE_AUTH_TOKEN
      : process.env.TURSO_AUTH_TOKEN;

  return createClient(authToken ? { url, authToken } : { url });
}

async function assertReachable(url: string, label: string): Promise<void> {
  const response = await fetch(url);
  ensure(
    response.ok,
    `${label} is not reachable at ${url} (HTTP ${response.status})`
  );
}

async function ensureDemoRpDatabaseReady(): Promise<void> {
  const client = createDbClient(demoRpDbUrl);

  try {
    const result = await client.execute({
      sql: "select name from sqlite_master where type = 'table' and name = ?",
      args: ["validity_notice"],
    });
    if (result.rows.length > 0) {
      return;
    }
  } finally {
    client.close();
  }

  const push = spawnSync("pnpm", ["run", "db:push"], {
    cwd: demoRpDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: demoRpDbUrl,
      ...(process.env.DEMO_RP_DATABASE_AUTH_TOKEN
        ? { DATABASE_AUTH_TOKEN: process.env.DEMO_RP_DATABASE_AUTH_TOKEN }
        : {}),
    },
  });

  ensureEqual(
    push.status ?? -1,
    0,
    "Failed to apply the demo-rp database schema before running the smoke test"
  );
}

async function resetAidProviderState(): Promise<void> {
  const client = createDbClient(demoRpDbUrl);

  try {
    await client.batch([
      {
        sql: "delete from validity_notice where providerId = ?",
        args: [providerId],
      },
      {
        sql: "delete from dcr_client where providerId = ?",
        args: [providerId],
      },
      {
        sql: "delete from oauth_dpop_key where providerId = ?",
        args: [`zentity-${providerId}`],
      },
      {
        sql: "delete from account where providerId = ?",
        args: [`zentity-${providerId}`],
      },
    ]);
  } finally {
    client.close();
  }
}

async function createIssuerUserSession() {
  const email = `demo-rp-smoke-${Date.now()}-${crypto.randomUUID()}@example.com`;
  const password = "TestPassword123!";
  const api = await request.newContext({
    baseURL: issuerBaseUrl,
    extraHTTPHeaders: {
      Origin: issuerBaseUrl,
      "Content-Type": "application/json",
    },
  });

  const response = await api.post("/api/auth/sign-up/email", {
    data: {
      email,
      name: "Demo RP Smoke",
      password,
    },
  });
  await expectResponseStatus(response, 200, "Issuer sign-up failed");

  const body = (await response.json()) as {
    user?: { id?: string };
  };
  const userId = body.user?.id;
  ensure(userId, "Issuer sign-up did not return a user id");

  return {
    api,
    email,
    password,
    storageState: await api.storageState(),
    userId,
  };
}

async function seedVerifiedIdentity(userId: string): Promise<void> {
  const client = createDbClient(issuerDbUrl);
  const verificationId = crypto.randomUUID();
  const verifiedAt = new Date(
    Date.now() - 120 * 24 * 60 * 60 * 1000
  ).toISOString();
  const expiredAt = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const dedupKey = `demo-rp-smoke-dedup-${crypto.randomUUID()}`;
  const uniqueIdentifier = `demo-rp-smoke-uid-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  try {
    await client.batch([
      {
        sql: `
          insert into identity_verifications (
            id,
            user_id,
            method,
            status,
            dedup_key,
            unique_identifier,
            verified_at,
            created_at,
            updated_at
          ) values (?, ?, 'ocr', 'verified', ?, ?, ?, ?, ?)
        `,
        args: [
          verificationId,
          userId,
          dedupKey,
          uniqueIdentifier,
          verifiedAt,
          now,
          now,
        ],
      },
      {
        sql: `
          insert into identity_bundles (
            user_id,
            effective_verification_id,
            rp_nullifier_seed,
            validity_status,
            last_verified_at,
            verification_expires_at,
            freshness_checked_at,
            verification_count,
            created_at,
            updated_at
          ) values (?, ?, ?, 'verified', ?, ?, ?, 1, ?, ?)
        `,
        args: [
          userId,
          verificationId,
          dedupKey,
          verifiedAt,
          expiredAt,
          verifiedAt,
          now,
          now,
        ],
      },
    ]);
  } finally {
    client.close();
  }
}

async function readAidClientId(): Promise<string> {
  const response = await fetch(
    `${demoRpBaseUrl}/api/dcr?providerId=${encodeURIComponent(providerId)}`
  );
  await expectResponseStatus(response, 200, "Unable to read demo-rp DCR state");

  const body = (await response.json()) as {
    client_id?: string;
    registered?: boolean;
  };

  ensure(body.registered, "The demo-rp aid provider is not registered");
  ensure(body.client_id, "The demo-rp aid provider is missing a client id");
  return body.client_id;
}

function extractSignedOAuthQuery(url: string): string {
  const params = new URL(url).searchParams;
  const signedParams = new URLSearchParams();

  for (const [key, value] of params.entries()) {
    signedParams.append(key, value);
    if (key === "sig") {
      break;
    }
  }

  const query = signedParams.toString();
  ensure(query.length > 0, "Consent URL is missing the signed OAuth query");
  return query;
}

async function waitForValidityState(
  page: import("playwright").Page,
  expectedStatus: string,
  expectedNotice: boolean
): Promise<Record<string, unknown>> {
  let lastBody: Record<string, unknown> | null = null;

  await expect
    .poll(
      async () => {
        lastBody = await page.evaluate(async (currentProviderId) => {
          const response = await fetch(
            `/api/auth/validity-state?providerId=${encodeURIComponent(currentProviderId)}`
          );
          if (!response.ok) {
            return null;
          }
          return (await response.json()) as Record<string, unknown>;
        }, providerId);

        const snapshot = lastBody?.snapshot as
          | { validityStatus?: string }
          | null
          | undefined;
        return {
          hasNotice: lastBody?.latestNotice != null,
          status: snapshot?.validityStatus ?? null,
        };
      },
      { intervals: [500, 500, 1000], timeout: 10_000 }
    )
    .toEqual({ hasNotice: expectedNotice, status: expectedStatus });

  ensure(
    lastBody,
    `Validity state poll satisfied but response body was null for ${expectedStatus}`
  );
  return lastBody;
}

async function triggerFreshnessTransition(): Promise<void> {
  ensure(
    adminApiKey,
    "ZENTITY_ADMIN_API_KEY must be set for the smoke test and the running issuer server"
  );

  const freshnessResponse = await fetch(
    `${issuerBaseUrl}/api/internal/validity/freshness`,
    {
      method: "POST",
      headers: {
        "x-zentity-admin-key": adminApiKey,
      },
    }
  );
  await expectResponseStatus(freshnessResponse, 200, "Freshness worker failed");

  const freshnessBody = (await freshnessResponse.json()) as {
    staleTransitionsCreated?: number;
  };
  ensure(
    typeof freshnessBody.staleTransitionsCreated === "number" &&
      freshnessBody.staleTransitionsCreated >= 1,
    "Freshness worker did not create a stale transition for the seeded identity"
  );
}

async function deliverValidityNotice(eventId: string): Promise<void> {
  ensure(
    adminApiKey,
    "ZENTITY_ADMIN_API_KEY must be set for the smoke test and the running issuer server"
  );

  const deliveryResponse = await fetch(
    `${issuerBaseUrl}/api/internal/validity/deliver`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zentity-admin-key": adminApiKey,
      },
      body: JSON.stringify({
        eventId,
        targets: ["rp_validity_notice"],
      }),
    }
  );
  await expectResponseStatus(
    deliveryResponse,
    200,
    "Validity delivery worker failed"
  );

  const deliveryBody = (await deliveryResponse.json()) as {
    attempted?: number;
    delivered?: number;
    retrying?: number;
  };
  ensure(
    typeof deliveryBody.delivered === "number" && deliveryBody.delivered >= 1,
    `Expected the current RP validity notice to be delivered, got ${JSON.stringify(deliveryBody)}`
  );
}

async function readStoredNotices(clientId: string) {
  const response = await fetch(
    `${demoRpBaseUrl}/api/auth/validity?clientId=${encodeURIComponent(clientId)}`
  );
  await expectResponseStatus(
    response,
    200,
    "Unable to read demo-rp validity notices"
  );
  return (await response.json()) as {
    notices: Array<{ validityStatus: string }>;
  };
}

async function run(): Promise<void> {
  await assertReachable(`${issuerBaseUrl}/api/status/health`, "Issuer");
  await assertReachable(`${demoRpBaseUrl}/`, "Demo RP");
  await ensureDemoRpDatabaseReady();
  await resetAidProviderState();

  const session = await createIssuerUserSession();
  await seedVerifiedIdentity(session.userId);

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });

  let page: import("playwright").Page | null = null;

  try {
    const context = await browser.newContext({
      storageState: session.storageState,
    });
    page = await context.newPage();

    await page.goto(`${demoRpBaseUrl}/${providerId}`, {
      waitUntil: "networkidle",
    });
    console.log(`[smoke] opened ${page.url()}`);

    const registerButton = page.getByRole("button", {
      name: "Register with Zentity",
    });
    const verifyIdentityButton = page.getByRole("button", {
      name: "Verify Identity",
    });
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click();
      await expect(verifyIdentityButton).toBeEnabled({ timeout: 10_000 });
      console.log("[smoke] registered demo-rp client");
    }

    await expect(verifyIdentityButton).toBeEnabled({ timeout: 10_000 });
    const aidUrl = `${demoRpBaseUrl}/${providerId}`;
    await verifyIdentityButton.click();
    await page.waitForURL((url) => url.toString() !== aidUrl, {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    console.log(`[smoke] after Verify Identity -> ${page.url()}`);

    if (page.url().includes("/oauth/consent")) {
      const consentUrl = new URL(page.url());
      const scope = consentUrl.searchParams.get("scope");
      const consentResponse = await session.api.post(
        "/api/auth/oauth2/consent",
        {
          data: {
            accept: true,
            ...(scope ? { scope } : {}),
            oauth_query: extractSignedOAuthQuery(page.url()),
          },
        }
      );
      await expectResponseStatus(
        consentResponse,
        200,
        "Consent approval failed"
      );

      const consentBody = (await consentResponse.json()) as {
        url?: string;
        uri?: string;
        redirect_uri?: string;
      };
      const redirectUrl =
        consentBody.url ?? consentBody.uri ?? consentBody.redirect_uri ?? null;
      ensure(redirectUrl, "Consent approval did not return a redirect URL");
      console.log(`[smoke] consent redirect -> ${redirectUrl}`);

      await page.goto(redirectUrl, {
        waitUntil: "networkidle",
      });
      console.log(`[smoke] after consent redirect -> ${page.url()}`);
    } else if (page.url().includes("/sign-in")) {
      throw new Error(
        "Issuer browser session was not bootstrapped. The smoke flow landed on /sign-in."
      );
    } else {
      await page.waitForURL(`${demoRpBaseUrl}/${providerId}`, {
        timeout: 30_000,
      });
      console.log(`[smoke] returned without consent -> ${page.url()}`);
    }
    await page.getByRole("heading", { name: "Beneficiary Dashboard" }).waitFor({
      timeout: 30_000,
    });

    const initialState = await waitForValidityState(page, "verified", false);
    ensureEqual(
      (initialState.snapshot as { validityStatus: string }).validityStatus,
      "verified",
      "The demo-rp pull route did not expose the verified issuer snapshot"
    );

    const clientId = await readAidClientId();
    const initialNotices = await readStoredNotices(clientId);
    ensureEqual(
      initialNotices.notices.length,
      0,
      "The smoke run expected a clean demo-rp notice store before delivery"
    );

    await triggerFreshnessTransition();
    await page.reload({ waitUntil: "networkidle" });

    const staleStateWithoutNotice = await waitForValidityState(
      page,
      "stale",
      false
    );
    const staleEventId =
      typeof (staleStateWithoutNotice.snapshot as { eventId?: unknown } | null)
        ?.eventId === "string"
        ? (
            staleStateWithoutNotice.snapshot as {
              eventId: string;
            }
          ).eventId
        : null;
    ensure(
      staleEventId,
      `Unable to determine the current stale event id from ${JSON.stringify(staleStateWithoutNotice)}`
    );

    await deliverValidityNotice(staleEventId);
    await page.reload({ waitUntil: "networkidle" });

    const staleState = await waitForValidityState(page, "stale", true);
    ensureEqual(
      (staleState.snapshot as { validityStatus: string }).validityStatus,
      "stale",
      "The demo-rp pull route did not reflect the stale issuer snapshot"
    );

    const storedNotices = await readStoredNotices(clientId);
    ensure(
      storedNotices.notices.some((notice) => notice.validityStatus === "stale"),
      "The demo-rp notice store did not persist the stale validity notice"
    );

    await page.getByText("Push received").waitFor({ timeout: 10_000 });
    console.log(
      JSON.stringify(
        {
          clientId,
          email: session.email,
          initialValidityStatus: (
            initialState.snapshot as { validityStatus: string }
          ).validityStatus,
          finalValidityStatus: (
            staleState.snapshot as { validityStatus: string }
          ).validityStatus,
          noticesStored: storedNotices.notices.length,
        },
        null,
        2
      )
    );
  } catch (error) {
    if (page) {
      await page.screenshot({
        fullPage: true,
        path: path.join(
          currentDir,
          "..",
          "test-results",
          "demo-rp-validity-smoke-failure.png"
        ),
      });
    }
    throw error;
  } finally {
    await browser.close();
    await session.api.dispose();
  }
}

async function main(): Promise<void> {
  await run();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

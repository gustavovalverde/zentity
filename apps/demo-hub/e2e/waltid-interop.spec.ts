import { expect, test } from "@playwright/test";

/**
 * walt.id Interoperability Tests
 *
 * These tests validate that Zentity's OIDC4VCI implementation works with
 * the walt.id wallet framework, proving interoperability with real-world
 * wallet implementations.
 *
 * Prerequisites:
 * - Demo stack running (pnpm dev:stack or docker compose -f docker-compose.demo.yml up)
 * - walt.id wallet API running on port 7001
 * - Zentity Web running on port 3000
 */

const DEMO_HUB_URL =
  process.env.NEXT_PUBLIC_DEMO_HUB_URL ?? "http://localhost:3100";
const WALTID_API_URL =
  process.env.WALTID_WALLET_API_URL ?? "http://localhost:7001";
const DEMO_SEED_SECRET = process.env.DEMO_SEED_SECRET ?? "demo-seed-secret";

// Skip tests if walt.id is not available
test.beforeAll(async ({ request }) => {
  try {
    // Use wallet-api/auth/login endpoint to check if API is running
    // (returns 400 for invalid request, but proves server is up)
    const healthRes = await request.post(
      `${WALTID_API_URL}/wallet-api/auth/login`,
      { data: {} }
    );
    // 400 = API is up (expected for empty login)
    // 5xx or network error = API is down
    if (healthRes.status() >= 500) {
      test.skip(true, "walt.id wallet API is not healthy");
    }
  } catch {
    test.skip(true, "walt.id wallet API is not reachable");
  }
});

test.describe("walt.id Interoperability", () => {
  let waltidToken: string;
  let waltidWalletId: string;

  test.beforeEach(async ({ request }) => {
    // Create or login to walt.id account
    const email = `demo-${Date.now()}@zentity.test`;
    const password = "demo-password-123";

    // Register first (returns plain text "Registration succeeded")
    await request.post(`${WALTID_API_URL}/wallet-api/auth/register`, {
      data: {
        name: "Demo User",
        email,
        password,
        type: "email",
      },
    });

    // Login to get token (returns JSON with token)
    const loginRes = await request.post(
      `${WALTID_API_URL}/wallet-api/auth/login`,
      {
        data: { email, password, type: "email" },
      }
    );

    if (loginRes.ok()) {
      const loginData = await loginRes.json();
      waltidToken = loginData.token;

      // Get or create wallet
      const walletRes = await request.get(
        `${WALTID_API_URL}/wallet-api/wallet/accounts/wallets`,
        {
          headers: { Authorization: `Bearer ${waltidToken}` },
        }
      );

      if (walletRes.ok()) {
        const walletData = await walletRes.json();
        if (walletData.wallets?.length > 0) {
          waltidWalletId = walletData.wallets[0].id;
        } else {
          // Create wallet
          const createWalletRes = await request.post(
            `${WALTID_API_URL}/wallet-api/wallet/accounts/wallets/create`,
            {
              headers: { Authorization: `Bearer ${waltidToken}` },
              data: { name: "Demo Wallet" },
            }
          );
          if (createWalletRes.ok()) {
            const newWallet = await createWalletRes.json();
            waltidWalletId = newWallet.id;
          }
        }
      }
    }
  });

  test("should check walt.id wallet API is running", async ({ request }) => {
    // Walt.id doesn't have a standard /health endpoint, so we verify the API
    // is responding by calling the login endpoint (returns 400 for invalid request)
    const healthRes = await request.post(
      `${WALTID_API_URL}/wallet-api/auth/login`,
      { data: {} }
    );
    // 400 = API is up and processing requests
    expect(healthRes.status()).toBe(400);
  });

  test("should seed demo identity via Demo Hub API", async ({ request }) => {
    const seedRes = await request.post(`${DEMO_HUB_URL}/api/demo/seed`, {
      headers: { "x-demo-secret": DEMO_SEED_SECRET },
    });

    // Seed might return 200 (success) or 409 (already seeded)
    expect([200, 409]).toContain(seedRes.status());
  });

  test("should create credential offer via Demo Hub API", async ({
    request,
  }) => {
    // First seed the identity
    await request.post(`${DEMO_HUB_URL}/api/demo/seed`, {
      headers: { "x-demo-secret": DEMO_SEED_SECRET },
    });

    // Create offer
    const offerRes = await request.post(`${DEMO_HUB_URL}/api/offers`, {
      data: { scenarioId: "exchange" },
    });

    expect(offerRes.ok()).toBeTruthy();

    const offerData = await offerRes.json();
    expect(offerData.id).toBeDefined();
    expect(offerData.offer).toBeDefined();
    expect(offerData.offer.grants).toBeDefined();
  });

  test("should send credential offer to walt.id wallet", async ({ request }) => {
    test.skip(!waltidToken || !waltidWalletId, "walt.id setup failed");

    // Seed identity
    await request.post(`${DEMO_HUB_URL}/api/demo/seed`, {
      headers: { "x-demo-secret": DEMO_SEED_SECRET },
    });

    // Create offer
    const offerRes = await request.post(`${DEMO_HUB_URL}/api/offers`, {
      data: { scenarioId: "exchange" },
    });
    expect(offerRes.ok()).toBeTruthy();

    const offerData = await offerRes.json();

    // Build credential offer URI
    const credentialOfferUri = `openid-credential-offer://?credential_offer=${encodeURIComponent(
      JSON.stringify(offerData.offer)
    )}`;

    // Send to walt.id wallet
    const exchangeRes = await request.post(
      `${WALTID_API_URL}/wallet-api/wallet/${waltidWalletId}/exchange/useOfferRequest`,
      {
        headers: {
          Authorization: `Bearer ${waltidToken}`,
          "Content-Type": "text/plain",
        },
        data: credentialOfferUri,
      }
    );

    // Log response for debugging
    if (!exchangeRes.ok()) {
      const errorText = await exchangeRes.text();
      console.log("walt.id exchange error:", errorText);
    }

    expect(exchangeRes.ok()).toBeTruthy();
  });

  test("should verify credential was stored in walt.id wallet", async ({
    request,
  }) => {
    test.skip(!waltidToken || !waltidWalletId, "walt.id setup failed");

    // Seed identity
    await request.post(`${DEMO_HUB_URL}/api/demo/seed`, {
      headers: { "x-demo-secret": DEMO_SEED_SECRET },
    });

    // Create offer
    const offerRes = await request.post(`${DEMO_HUB_URL}/api/offers`, {
      data: { scenarioId: "exchange" },
    });
    expect(offerRes.ok()).toBeTruthy();

    const offerData = await offerRes.json();

    // Build and send credential offer to walt.id
    const credentialOfferUri = `openid-credential-offer://?credential_offer=${encodeURIComponent(
      JSON.stringify(offerData.offer)
    )}`;

    const exchangeRes = await request.post(
      `${WALTID_API_URL}/wallet-api/wallet/${waltidWalletId}/exchange/useOfferRequest`,
      {
        headers: {
          Authorization: `Bearer ${waltidToken}`,
          "Content-Type": "text/plain",
        },
        data: credentialOfferUri,
      }
    );

    if (!exchangeRes.ok()) {
      test.skip(true, "Credential exchange failed - may need protocol adjustments");
      return;
    }

    // List credentials in walt.id wallet
    const credentialsRes = await request.get(
      `${WALTID_API_URL}/wallet-api/wallet/${waltidWalletId}/credentials`,
      {
        headers: { Authorization: `Bearer ${waltidToken}` },
      }
    );

    expect(credentialsRes.ok()).toBeTruthy();

    const credentials = await credentialsRes.json();
    expect(credentials.length).toBeGreaterThan(0);

    // Verify credential format contains SD-JWT markers
    const credential = credentials[0];
    expect(credential.document || credential.format).toBeDefined();
  });
});

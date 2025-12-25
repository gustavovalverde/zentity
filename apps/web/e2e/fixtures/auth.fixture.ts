/* eslint react-hooks/rules-of-hooks: off */
import {
  type APIRequestContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000";

/**
 * Sign up a user via the better-auth API directly (bypasses the wizard UI)
 */
async function signUpViaAPI(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
) {
  const response = await request.post(`${BASE_URL}/api/auth/sign-up/email`, {
    data: {
      email,
      password,
      name,
    },
    headers: {
      Origin: BASE_URL,
      "Content-Type": "application/json",
    },
  });
  return response;
}

/**
 * Sign in a user via the better-auth API directly
 */
async function signInViaAPI(
  request: APIRequestContext,
  email: string,
  password: string,
) {
  const response = await request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    data: {
      email,
      password,
    },
    headers: {
      Origin: BASE_URL,
      "Content-Type": "application/json",
    },
  });
  return response;
}

/**
 * Helper to create and authenticate a test user via API
 * Returns the session cookie to be used in subsequent requests
 */
export async function createAuthenticatedUser(
  page: Page,
  request: APIRequestContext,
  email?: string,
  password?: string,
) {
  const testEmail = email || `e2e-${Date.now()}@example.com`;
  const testPassword = password || "TestPassword123!";
  const testName = testEmail.split("@")[0];

  const applyCookies = async (
    response: Awaited<ReturnType<typeof signInViaAPI>>,
  ) => {
    const cookies = response.headers()["set-cookie"];
    if (!cookies) return;

    const cookieStrings = Array.isArray(cookies) ? cookies : [cookies];
    for (const cookieStr of cookieStrings) {
      const [nameValue] = cookieStr.split(";");
      const [name, value] = nameValue.split("=");
      if (name && value) {
        await page.context().addCookies([
          {
            name: name.trim(),
            value: value.trim(),
            domain: "localhost",
            path: "/",
          },
        ]);
      }
    }
  };

  // Prefer sign-up to avoid auth rate-limit issues in local/test environments.
  // better-auth typically sets session cookies on sign-up, so we can use them directly.
  const signUpResponse = await signUpViaAPI(
    request,
    testEmail,
    testPassword,
    testName,
  );

  if (signUpResponse.ok()) {
    await applyCookies(signUpResponse);
    return { email: testEmail, password: testPassword };
  }

  // If the user already exists or sign-up is rejected, fall back to sign-in.
  let signInResponse = await signInViaAPI(request, testEmail, testPassword);
  if (!signInResponse.ok()) {
    // Small retry for transient rate limits.
    if (signInResponse.status() === 429) {
      await page.waitForTimeout(1500);
      signInResponse = await signInViaAPI(request, testEmail, testPassword);
    }
  }

  if (!signInResponse.ok()) {
    throw new Error(`Failed to sign in: ${await signInResponse.text()}`);
  }

  await applyCookies(signInResponse);

  return { email: testEmail, password: testPassword };
}

/**
 * Extended test fixture with authentication helpers.
 * Uses direct API calls to create and authenticate test users.
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page, request }, use) => {
    await createAuthenticatedUser(page, request);
    await use(page);
  },
});

export { expect };

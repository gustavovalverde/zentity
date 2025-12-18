import * as fs from "node:fs";
import * as path from "node:path";

import { type APIResponse, type FullConfig, request } from "@playwright/test";

const AUTH_STATE_PATH = path.join(__dirname, ".auth", "user.json");

type ApiContext = Awaited<ReturnType<typeof request.newContext>>;

async function postWithRetries(
  api: ApiContext,
  url: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  let lastText = "";

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await api.post(url, { data });
    if (response.ok()) return response;

    lastText = await response.text().catch(() => "");
    if (response.status() !== 429) return response;

    const delayMs = 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Failed request ${url}: ${lastText}`);
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    "http://localhost:3000";

  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  const email =
    process.env.E2E_EMAIL ?? `e2e-${Date.now().toString(16)}@example.com`;
  const password = process.env.E2E_PASSWORD ?? "TestPassword123!";
  const name = process.env.E2E_NAME ?? "e2e";

  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: baseURL,
      "Content-Type": "application/json",
    },
  });

  // Create user (ignore failures like "already exists").
  await api
    .post("/api/auth/sign-up/email", {
      data: { email, password, name },
    })
    .catch(() => undefined);

  const signInResponse = await postWithRetries(api, "/api/auth/sign-in/email", {
    email,
    password,
  });

  if (!signInResponse.ok()) {
    throw new Error(
      `E2E global setup failed to sign in: ${await signInResponse.text()}`,
    );
  }

  await api.storageState({ path: AUTH_STATE_PATH });
  await api.dispose();
}

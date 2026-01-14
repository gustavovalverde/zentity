import "server-only";

import { ensureDemoUser } from "@/lib/demo/bootstrap";

interface BootstrapRequest {
  email?: string;
  password?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request) {
  const secret = process.env.DEMO_SEED_SECRET;
  if (!secret) {
    return false;
  }
  const header = req.headers.get("x-demo-secret");
  return header === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: BootstrapRequest = {};
  try {
    payload = (await req.json()) as BootstrapRequest;
  } catch {
    payload = {};
  }

  const email = payload.email?.trim();
  const password = payload.password?.trim();
  if (!(email && password)) {
    return jsonResponse({ error: "Missing email or password" }, 400);
  }

  const result = await ensureDemoUser(email, password);
  return jsonResponse({ ok: true, userId: result.userId });
}

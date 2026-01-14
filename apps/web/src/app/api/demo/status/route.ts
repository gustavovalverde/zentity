import "server-only";

import { getUserByEmail } from "@/lib/db/queries/recovery";
import { getDemoIdentityStatus } from "@/lib/demo/status";

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

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim();
  if (!email) {
    return jsonResponse({ error: "Missing email" }, 400);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const status = await getDemoIdentityStatus(user.id);
  return jsonResponse({ ok: true, userId: user.id, status });
}

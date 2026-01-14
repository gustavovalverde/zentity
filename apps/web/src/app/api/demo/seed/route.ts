import "server-only";

import { getUserByEmail } from "@/lib/db/queries/recovery";
import { seedDemoIdentity } from "@/lib/demo/seed";

interface SeedRequest {
  email?: string;
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

  let payload: SeedRequest = {};
  try {
    payload = (await req.json()) as SeedRequest;
  } catch {
    payload = {};
  }

  const email = payload.email?.trim();
  if (!email) {
    return jsonResponse({ error: "Missing email" }, 400);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return jsonResponse({ error: "User not found" }, 404);
  }

  const result = await seedDemoIdentity(user.id);
  return jsonResponse({
    ok: true,
    userId: result.userId,
    documentId: result.documentId,
    policyVersion: result.policyVersion,
  });
}

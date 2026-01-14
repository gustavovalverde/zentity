import { seedDemoIdentity } from "@/lib/zentity-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST() {
  try {
    await seedDemoIdentity();
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Seed failed" },
      500
    );
  }
}

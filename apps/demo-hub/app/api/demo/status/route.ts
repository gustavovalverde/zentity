import { fetchDemoStatus } from "@/lib/zentity-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET() {
  try {
    const status = await fetchDemoStatus();
    return jsonResponse(status);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Status failed" },
      500
    );
  }
}

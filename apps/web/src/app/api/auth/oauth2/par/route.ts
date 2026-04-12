import { auth } from "@/lib/auth/auth-config";

/**
 * PAR endpoint — RFC 9126 §2.1 requires application/x-www-form-urlencoded.
 * better-auth's createAuthEndpoint only accepts JSON, so this route
 * converts form-urlencoded bodies before forwarding to the auth handler.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.text();
    const params = new URLSearchParams(formData);
    const body: Record<string, string> = {};
    for (const [key, value] of params) {
      body[key] = value;
    }

    const jsonRequest = new Request(request.url, {
      method: "POST",
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        "content-type": "application/json",
      }),
      body: JSON.stringify(body),
    });

    return auth.handler(jsonRequest);
  }

  return auth.handler(request);
}

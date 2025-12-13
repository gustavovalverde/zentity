import { NextResponse } from "next/server";
/**
 * Breached password check endpoint (UX-only).
 *
 * Why this exists:
 * - Better Auth already blocks compromised passwords on the auth endpoints.
 * - This endpoint exists to provide *pre-submit UX feedback* so users can fix
 *   their password before hitting the real auth endpoint.
 *
 * Privacy/Security:
 * - Uses the Have I Been Pwned "range" API (k-anonymity). We only send the first
 *   5 chars of the SHA-1 hash prefix to HIBP.
 * - The raw password is never sent to HIBP.
 * - This endpoint receives a SHA-1 hash of the password (from our own client),
 *   not the raw password. It must not be logged or stored; we only return
 *   `{ compromised: boolean }`.
 *
 * Response contract:
 * - `{ skipped: true }` indicates "not checked" (invalid payload or upstream error).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PwnedCheckResponse = {
  compromised: boolean;
  skipped: boolean;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { compromised: false, skipped: true } satisfies PwnedCheckResponse,
      { status: 200 },
    );
  }

  const sha1 =
    typeof body === "object" && body && "sha1" in body
      ? (body as { sha1?: unknown }).sha1
      : undefined;

  if (typeof sha1 !== "string") {
    return NextResponse.json(
      { compromised: false, skipped: true } satisfies PwnedCheckResponse,
      { status: 200 },
    );
  }

  const normalizedSha1 = sha1.trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(normalizedSha1)) {
    return NextResponse.json(
      { compromised: false, skipped: true } satisfies PwnedCheckResponse,
      { status: 200 },
    );
  }

  const prefix = normalizedSha1.substring(0, 5);
  const suffix = normalizedSha1.substring(5);

  const response = await fetch(
    `https://api.pwnedpasswords.com/range/${prefix}`,
    {
      method: "GET",
      cache: "no-store",
      signal: request.signal,
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Zentity Password Checker",
      },
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      { compromised: false, skipped: true } satisfies PwnedCheckResponse,
      { status: 200 },
    );
  }

  const data = await response.text();
  const compromised = data
    .split("\n")
    .some((line) => line.split(":")[0]?.toUpperCase() === suffix);

  return NextResponse.json(
    { compromised, skipped: false } satisfies PwnedCheckResponse,
    { status: 200 },
  );
}

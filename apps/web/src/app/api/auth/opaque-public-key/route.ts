import { ready, server } from "@serenity-kit/opaque";

import { env } from "@/env";

let cachedPublicKey: string | null = null;

async function getPublicKey(): Promise<string> {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  await ready;
  cachedPublicKey = server.getPublicKey(env.OPAQUE_SERVER_SETUP);
  const pinned = env.NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY?.trim();
  if (pinned && pinned !== cachedPublicKey) {
    throw new Error(
      "NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY does not match OPAQUE_SERVER_SETUP"
    );
  }
  return cachedPublicKey;
}

/**
 * Returns the OPAQUE server's public key for client-side pinning.
 *
 * Derived from OPAQUE_SERVER_SETUP at runtime. Clients use it to verify
 * the server's identity during OPAQUE authentication (MITM protection).
 */
export async function GET() {
  try {
    const publicKey = await getPublicKey();
    return Response.json({ publicKey });
  } catch (error) {
    console.error("Failed to get OPAQUE public key:", error);
    return Response.json({ error: "OPAQUE not configured" }, { status: 503 });
  }
}

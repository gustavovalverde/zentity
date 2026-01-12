import { getOpaqueServerPublicKey } from "@/lib/utils/env";

/**
 * Returns the OPAQUE server's public key for client-side pinning.
 *
 * This key is derived from OPAQUE_SERVER_SETUP at runtime and is safe
 * to expose. Clients use it to verify the server's identity during
 * OPAQUE authentication (MITM protection).
 */
export async function GET() {
  try {
    const publicKey = await getOpaqueServerPublicKey();
    return Response.json({ publicKey });
  } catch (error) {
    console.error("Failed to get OPAQUE public key:", error);
    return Response.json({ error: "OPAQUE not configured" }, { status: 503 });
  }
}

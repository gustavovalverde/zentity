import { compactDecrypt, importJWK } from "jose";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getVpSessionByState, updateVpSession } from "@/lib/oid4vp";
import { verifyVpToken } from "@/lib/verify";

/**
 * Handles the wallet's `direct_post.jwt` response.
 *
 * Flow:
 * 1. Extract `response` (JWE) and `state` from POST body
 * 2. Look up VP session by state
 * 3. Decrypt JWE with session's ephemeral ECDH-ES private key
 * 4. Extract and verify VP token
 * 5. Update session with result
 * 6. Return redirect_uri for same-device flow
 */
export async function POST(request: Request) {
  let state: string | undefined;
  let encryptedResponse: string | undefined;

  // Accept both form-urlencoded and JSON
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    state = formData.get("state") as string | undefined;
    encryptedResponse = formData.get("response") as string | undefined;
  } else {
    const body = (await request.json()) as {
      state?: string;
      response?: string;
    };
    state = body.state;
    encryptedResponse = body.response;
  }

  if (!(state && encryptedResponse)) {
    return NextResponse.json(
      { error: "Missing state or response" },
      { status: 400 }
    );
  }

  // Look up session by state (correlation key)
  const session = await getVpSessionByState(state);
  if (!session) {
    return NextResponse.json({ error: "Unknown VP session" }, { status: 404 });
  }

  // Check session is still pending and not expired
  if (session.status !== "pending") {
    return NextResponse.json(
      { error: `Session is ${session.status}` },
      { status: 409 }
    );
  }

  if (new Date() > session.expiresAt) {
    await updateVpSession(session.id, { status: "expired" });
    return NextResponse.json({ error: "Session expired" }, { status: 410 });
  }

  try {
    // Decrypt the JWE response with the session's ephemeral key
    const ephemeralPrivateJwk = JSON.parse(session.encryptionKey);
    const privateKey = await importJWK(ephemeralPrivateJwk, "ECDH-ES");

    const { plaintext } = await compactDecrypt(encryptedResponse, privateKey);
    const decrypted = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
      string,
      unknown
    >;

    const vpToken =
      typeof decrypted.vp_token === "string" ? decrypted.vp_token : undefined;
    if (!vpToken) {
      await updateVpSession(session.id, { status: "failed" });
      return NextResponse.json(
        { error: "No vp_token in decrypted response" },
        { status: 400 }
      );
    }

    // Verify the VP token
    const clientId = env.NEXT_PUBLIC_APP_URL;
    const { verified, claims } = await verifyVpToken(
      vpToken,
      session.nonce,
      clientId
    );

    if (!verified) {
      await updateVpSession(session.id, {
        status: "failed",
        result: JSON.stringify({ error: "Verification failed" }),
      });
      return NextResponse.json(
        { error: "VP token verification failed" },
        { status: 400 }
      );
    }

    await updateVpSession(session.id, {
      status: "verified",
      result: JSON.stringify(claims),
    });

    // Return redirect_uri for same-device flow
    return NextResponse.json({
      redirect_uri: `${env.NEXT_PUBLIC_APP_URL}/vp/complete?session_id=${session.id}`,
    });
  } catch (e) {
    await updateVpSession(session.id, {
      status: "failed",
      result: JSON.stringify({
        error: e instanceof Error ? e.message : "Processing failed",
      }),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Processing failed" },
      { status: 500 }
    );
  }
}

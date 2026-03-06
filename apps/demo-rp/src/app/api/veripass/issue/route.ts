import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { createDpopClient } from "@/lib/dpop";
import { env } from "@/lib/env";

const TRAILING_PADDING_RE = /=+$/;

interface CredentialOffer {
  credential_configuration_ids: string[];
  credential_issuer: string;
  grants: {
    "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
      "pre-authorized_code": string;
    };
  };
}

async function parseOfferUri(raw: string): Promise<CredentialOffer> {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const url = new URL(
    trimmed.replace("openid-credential-offer://", "https://dummy/")
  );
  const params = url.searchParams;

  const inlineOffer = params.get("credential_offer");
  if (inlineOffer) {
    return JSON.parse(inlineOffer);
  }

  const offerUri = params.get("credential_offer_uri");
  if (offerUri) {
    const res = await fetch(offerUri);
    if (!res.ok) {
      throw new Error(`Failed to fetch offer: ${res.status}`);
    }
    return (await res.json()) as CredentialOffer;
  }

  throw new Error("Invalid credential offer URI");
}

export async function POST(request: Request) {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as { offerUri?: string };
  if (!body.offerUri) {
    return NextResponse.json({ error: "Missing offerUri" }, { status: 400 });
  }

  try {
    const offer = await parseOfferUri(body.offerUri);

    if (!(offer.credential_issuer && offer.grants)) {
      return NextResponse.json(
        { error: "Invalid credential offer" },
        { status: 400 }
      );
    }

    const grant =
      offer.grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"];
    if (!grant?.["pre-authorized_code"]) {
      return NextResponse.json(
        { error: "Offer missing pre-authorized code grant" },
        { status: 400 }
      );
    }

    // Create ephemeral DPoP client for this issuance session
    const dpop = await createDpopClient();

    const tokenUrl = `${offer.credential_issuer}/oauth2/token`;
    const credentialUrl = `${offer.credential_issuer}/oidc4vci/credential`;

    // 1. Exchange pre-authorized code for token (with DPoP)
    const tokenBody = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:pre-authorized_code",
      "pre-authorized_code": grant["pre-authorized_code"],
      client_id: env.OIDC4VCI_WALLET_CLIENT_ID,
    });

    const { response: tokenRes, result: tokenData } = await dpop.withNonceRetry(
      async (nonce) => {
        const dpopProof = await dpop.proofFor(
          "POST",
          tokenUrl,
          undefined,
          nonce
        );
        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            DPoP: dpopProof,
          },
          body: tokenBody,
        });
        if (
          !response.ok &&
          response.status !== 400 &&
          response.status !== 401
        ) {
          const text = await response.text();
          throw new Error(`Token exchange failed: ${response.status} ${text}`);
        }
        const result = response.ok
          ? ((await response.json()) as {
              access_token: string;
              c_nonce: string;
            })
          : ({ access_token: "", c_nonce: "" } as {
              access_token: string;
              c_nonce: string;
            });
        return { response, result };
      }
    );

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Token exchange failed: ${tokenRes.status} ${text}` },
        { status: 502 }
      );
    }

    // 2. Generate holder key pair (EdDSA / Ed25519)
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const holderPublicJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey
    );
    const holderPrivateJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.privateKey
    );

    // 3. Create proof JWT
    const proofJwt = await createProofJwt(
      tokenData.c_nonce,
      offer.credential_issuer,
      holderPublicJwk,
      keyPair.privateKey
    );

    // 4. Request credential (with DPoP — credential endpoint requires it)
    const configId =
      offer.credential_configuration_ids[0] || "identity_verification";

    const { response: credRes, result: credRaw } = await dpop.withNonceRetry(
      async (nonce) => {
        const dpopProof = await dpop.proofFor(
          "POST",
          credentialUrl,
          tokenData.access_token,
          nonce
        );
        const response = await fetch(credentialUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `DPoP ${tokenData.access_token}`,
            DPoP: dpopProof,
          },
          body: JSON.stringify({
            credential_configuration_id: configId,
            proofs: { jwt: [proofJwt] },
          }),
        });
        if (
          !response.ok &&
          response.status !== 400 &&
          response.status !== 401
        ) {
          const text = await response.text();
          throw new Error(
            `Credential request failed: ${response.status} ${text}`
          );
        }
        const result = response.ok
          ? ((await response.json()) as Record<string, unknown>)
          : {};
        return { response, result };
      }
    );

    if (!credRes.ok) {
      const text = await credRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Credential request failed: ${credRes.status} ${text}` },
        { status: 502 }
      );
    }

    const credential =
      typeof credRaw.credential === "string"
        ? credRaw.credential
        : (
            credRaw.credentials as Array<{ credential?: string }> | undefined
          )?.[0]?.credential;
    if (!credential) {
      return NextResponse.json(
        { error: "No credential in issuer response" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      credential,
      issuer: offer.credential_issuer,
      holderPublicJwk,
      holderPrivateJwk,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Issuance failed" },
      { status: 500 }
    );
  }
}

async function createProofJwt(
  nonce: string,
  audience: string,
  holderPublicJwk: JsonWebKey,
  holderPrivateKey: CryptoKey
): Promise<string> {
  const header = {
    alg: "EdDSA",
    jwk: holderPublicJwk,
    typ: "openid4vci-proof+jwt",
  };
  const payload = {
    aud: audience,
    nonce,
    iat: Math.floor(Date.now() / 1000),
  };

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    holderPrivateKey,
    signingInput
  );
  const sigB64 = arrayToBase64Url(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function toBase64Url(str: string): string {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(TRAILING_PADDING_RE, "");
}

function arrayToBase64Url(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(TRAILING_PADDING_RE, "");
}

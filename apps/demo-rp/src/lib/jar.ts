import "server-only";

import { importPKCS8, SignJWT } from "jose";

/**
 * Signs an OID4VP authorization request as a JAR JWT (RFC 9101).
 *
 * Header: { alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [...] }
 * Payload: all authorization request parameters
 */
export async function signAuthorizationRequest(
  params: Record<string, unknown>,
  signingKeyPem: string,
  x5cChain: string[]
): Promise<string> {
  const privateKey = await importPKCS8(signingKeyPem, "ES256");

  return new SignJWT(params)
    .setProtectedHeader({
      alg: "ES256",
      typ: "oauth-authz-req+jwt",
      x5c: x5cChain,
    })
    .setIssuedAt()
    .sign(privateKey);
}

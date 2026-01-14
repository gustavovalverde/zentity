import { NextResponse } from "next/server";

/**
 * VCT (Verifiable Credential Type) metadata endpoint
 * Required by some wallets (like walt.id) that try to resolve VCT URLs to fetch type metadata
 *
 * This serves credential type information according to SD-JWT VC specification
 * @see https://www.ietf.org/archive/id/draft-ietf-oauth-sd-jwt-vc-08.html#name-type-metadata
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;

  const vctMetadata: Record<
    string,
    {
      name: string;
      description: string;
      display?: { name: string; locale: string }[];
      claims?: Record<string, { display?: { name: string; locale: string }[] }>;
    }
  > = {
    zentity_identity: {
      name: "Zentity Identity Credential",
      description:
        "A verifiable credential containing identity verification claims including document verification, liveness checks, and ZK proofs.",
      display: [
        { name: "Zentity Identity Credential", locale: "en-US" },
        { name: "Credencial de Identidad Zentity", locale: "es" },
      ],
      claims: {
        verification_level: {
          display: [
            { name: "Verification Level", locale: "en-US" },
            { name: "Nivel de Verificación", locale: "es" },
          ],
        },
        verified: {
          display: [
            { name: "Verified", locale: "en-US" },
            { name: "Verificado", locale: "es" },
          ],
        },
        document_verified: {
          display: [
            { name: "Document Verified", locale: "en-US" },
            { name: "Documento Verificado", locale: "es" },
          ],
        },
        liveness_verified: {
          display: [
            { name: "Liveness Verified", locale: "en-US" },
            { name: "Vivacidad Verificada", locale: "es" },
          ],
        },
      },
    },
    "zentity_identity:deferred": {
      name: "Zentity Identity Credential (Deferred)",
      description:
        "A deferred verifiable credential for identity verification, issued asynchronously.",
      display: [
        { name: "Zentity Identity Credential (Deferred)", locale: "en-US" },
      ],
    },
  };

  const metadata = vctMetadata[type];
  if (!metadata) {
    return NextResponse.json(
      { error: "Unknown credential type" },
      { status: 404 }
    );
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}

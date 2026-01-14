import { NextResponse } from "next/server";

// Extract VCT type from path - moved to top level for performance
const VCT_PATH_REGEX = /api\/auth\/vct\/(.+)$/;

/**
 * .well-known/vct endpoint for SD-JWT VC type metadata
 *
 * According to SD-JWT VC spec (draft-ietf-oauth-sd-jwt-vc-08), when VCT is a URL like
 * `http://issuer.example/path/to/type`, the metadata should be fetched from
 * `http://issuer.example/.well-known/vct/path/to/type`
 *
 * This route handles requests like:
 *   GET /.well-known/vct/api/auth/vct/zentity_identity
 *
 * @see https://www.ietf.org/archive/id/draft-ietf-oauth-sd-jwt-vc-08.html#name-type-metadata
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // The path after .well-known/vct/ should match the original VCT URL path
  // e.g., ["api", "auth", "vct", "zentity_identity"]
  const fullPath = path.join("/");

  // Extract the credential type from the path
  // Expected format: api/auth/vct/{type}
  const vctMatch = fullPath.match(VCT_PATH_REGEX);
  if (!vctMatch) {
    return NextResponse.json(
      { error: "Invalid VCT path format" },
      { status: 404 }
    );
  }

  const type = vctMatch[1];

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
        face_match_verified: {
          display: [
            { name: "Face Match Verified", locale: "en-US" },
            { name: "Coincidencia Facial Verificada", locale: "es" },
          ],
        },
        age_proof_verified: {
          display: [
            { name: "Age Proof Verified", locale: "en-US" },
            { name: "Prueba de Edad Verificada", locale: "es" },
          ],
        },
        doc_validity_proof_verified: {
          display: [
            { name: "Document Validity Proof", locale: "en-US" },
            { name: "Prueba de Validez del Documento", locale: "es" },
          ],
        },
        nationality_proof_verified: {
          display: [
            { name: "Nationality Proof", locale: "en-US" },
            { name: "Prueba de Nacionalidad", locale: "es" },
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
      { error: `Unknown credential type: ${type}` },
      { status: 404 }
    );
  }

  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "application/json",
    },
  });
}

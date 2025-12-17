import { NextResponse } from "next/server";

/**
 * Build info endpoint for deployment verification.
 *
 * Allows users to verify the deployed code matches the source.
 * Compare gitSha with GitHub releases and Sigstore attestations.
 *
 * @example
 * // Verify with gh CLI:
 * gh attestation verify oci://ghcr.io/owner/zentity/web:latest --owner owner
 *
 * // Verify with cosign:
 * cosign verify ghcr.io/owner/zentity/web@<digest> \
 *   --certificate-identity-regexp="https://github.com/owner/zentity/.github/workflows/build-attest.yml@.*" \
 *   --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
 */
export async function GET() {
  return NextResponse.json(
    {
      service: "web",
      version: process.env.npm_package_version || "1.0.0",
      gitSha:
        process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_SHA || "unknown",
      buildTime: process.env.BUILD_TIME || "unknown",
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

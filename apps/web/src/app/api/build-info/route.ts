import { execSync } from "node:child_process";
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

function getGitSha(): string {
  // CI/Docker/Vercel environments
  if (process.env.VERCEL_GIT_COMMIT_SHA)
    return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.GIT_SHA) return process.env.GIT_SHA;

  // Local development fallback
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

function getBuildTime(): string {
  if (process.env.BUILD_TIME) return process.env.BUILD_TIME;

  // Local development - return current time (changes on each request, but that's fine for dev)
  return new Date().toISOString();
}

export async function GET() {
  return NextResponse.json(
    {
      service: "web",
      version: process.env.npm_package_version || "1.0.0",
      gitSha: getGitSha(),
      buildTime: getBuildTime(),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

import { env } from "@/env";

export const DEV_RELEASE_ID = "dev";

// The Dockerfiles default GIT_SHA to "unknown" when no build argument is passed.
function commitSha(value: string | undefined): string | undefined {
  return value && value !== "unknown" ? value : undefined;
}

/**
 * The commit this build was made from. Telemetry `service.version`, the
 * build-info endpoint, and the agent token `audit.release_id` all report it, so
 * a trace, a deployment check, and a token can be matched to the same release.
 */
export function getReleaseId(): string {
  return (
    commitSha(env.GIT_SHA) ??
    commitSha(env.VERCEL_GIT_COMMIT_SHA) ??
    commitSha(env.RAILWAY_GIT_COMMIT_SHA) ??
    DEV_RELEASE_ID
  );
}

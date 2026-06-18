import "server-only";

import { createHash } from "node:crypto";

/**
 * Hashes a raw CIBA `auth_req_id` for storage and lookup.
 *
 * The 1.7 CIBA plugin persists only the SHA-256 + base64url(no-pad) digest of
 * the high-entropy `auth_req_id` in `ciba_request.auth_req_id` (the raw value is
 * a bearer credential). Every Zentity store keyed by the CIBA request id
 * (release context, identity payload, token snapshot, agent-session binding)
 * must key on the same hash so lookups align with the plugin's storage.
 */
export function hashCibaAuthReqId(rawAuthReqId: string): string {
  return createHash("sha256")
    .update(new TextEncoder().encode(rawAuthReqId))
    .digest("base64url");
}

/**
 * Extracts the raw `auth_req_id` query parameter the CIBA plugin attaches to the
 * notification `approvalUrl`. Returns `undefined` when the URL is malformed or
 * the parameter is absent.
 */
export function rawAuthReqIdFromApprovalUrl(
  approvalUrl: string
): string | undefined {
  try {
    return new URL(approvalUrl).searchParams.get("auth_req_id") ?? undefined;
  } catch {
    return undefined;
  }
}

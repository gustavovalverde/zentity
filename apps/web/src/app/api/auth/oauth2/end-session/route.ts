import { auth } from "@/lib/auth/auth-config";

/**
 * Delegate RP-Initiated Logout to the OAuth provider so ID-token validation,
 * session matching, token revocation, back-channel logout, confirmation, and
 * registered post-logout redirects share one provider-owned lifecycle.
 */
export function GET(request: Request): Promise<Response> {
  return auth.handler(request);
}

export function POST(request: Request): Promise<Response> {
  return auth.handler(request);
}

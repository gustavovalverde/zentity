import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";

import { auth } from "@/lib/auth/auth-config";
import {
  DEFAULT_AUTH_BASE_PATH,
  issuerPathMatches,
} from "@/lib/auth/oidc/well-known";

const serveAuthServerMetadata = oauthProviderAuthServerMetadata(auth);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ issuer?: string[] }> }
) {
  const { issuer: issuerSegments } = await params;
  if (!issuerPathMatches(issuerSegments?.join("/"), DEFAULT_AUTH_BASE_PATH)) {
    return new Response("Not Found", { status: 404 });
  }
  return serveAuthServerMetadata(request);
}

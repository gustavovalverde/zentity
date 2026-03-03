import { auth } from "@/lib/auth/auth";
import {
  buildWellKnownResponse,
  DEFAULT_AUTH_BASE_PATH,
  enrichDiscoveryMetadata,
  issuerPathMatches,
  unwrapMetadata,
} from "@/lib/auth/well-known-utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ issuer?: string[] }> }
) {
  const { issuer: issuerSegments } = await params;
  const requestedPath = issuerSegments?.join("/") ?? "";

  if (!issuerPathMatches(requestedPath, DEFAULT_AUTH_BASE_PATH)) {
    return new Response("Not Found", { status: 404 });
  }

  const metadata = unwrapMetadata(await auth.api.getOAuthServerConfig());

  const enriched =
    typeof metadata === "object" && metadata !== null
      ? enrichDiscoveryMetadata(metadata as Record<string, unknown>)
      : metadata;

  return buildWellKnownResponse(enriched);
}

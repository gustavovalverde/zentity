import { getPublishedJwks } from "@/lib/auth/oidc/jwt-signer";

export async function GET() {
  return Response.json(await getPublishedJwks(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}

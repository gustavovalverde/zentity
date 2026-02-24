import { getMlDsaPublicJwks } from "@/lib/auth/oidc/ml-dsa-signer";

export async function GET() {
  const keys = await getMlDsaPublicJwks();
  return Response.json(
    { keys },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

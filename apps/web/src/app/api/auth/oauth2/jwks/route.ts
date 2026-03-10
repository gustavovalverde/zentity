import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/jwks";

export async function GET() {
  const allKeys = await db.select().from(jwks);

  const keys = allKeys.map((row) => {
    const publicKeyData = JSON.parse(row.publicKey) as Record<string, unknown>;
    return {
      ...publicKeyData,
      kid: row.id,
      ...(row.alg ? { alg: row.alg } : {}),
      ...(row.crv ? { crv: row.crv } : {}),
    };
  });

  return Response.json(
    { keys },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

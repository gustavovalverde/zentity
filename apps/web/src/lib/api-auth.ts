import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth, type Session } from "@/lib/auth";

export async function requireSession(): Promise<
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!session.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, session };
}

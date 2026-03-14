import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import { auth, type Session } from "./auth";

export async function requireSession(
  requestHeaders?: Headers
): Promise<
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const hdrs = requestHeaders ?? (await nextHeaders());
  const session = await auth.api.getSession({
    headers: hdrs,
  });

  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ),
    };
  }

  return { ok: true, session };
}

import type { Session } from "@/lib/auth/auth";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/api-auth";
import { db } from "@/lib/db/connection";
import { members } from "@/lib/db/schema/organization";

const ADMIN_ROLES = new Set(["owner", "admin"]);

export async function requireRpAdmin(
  requestHeaders: Headers
): Promise<
  | { ok: true; session: Session; organizationId: string }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const sessionResult = await requireSession(requestHeaders);
  if (!sessionResult.ok) {
    return sessionResult;
  }

  const session = sessionResult.session;
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No active organization set." },
        { status: 400 }
      ),
    };
  }

  const member = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(members.userId, session.user.id)
      )
    )
    .limit(1)
    .get();

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You are not a member of the active organization." },
        { status: 403 }
      ),
    };
  }

  if (!ADMIN_ROLES.has(member.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Organization admin role required." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, session, organizationId };
}

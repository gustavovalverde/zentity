import type { Session } from "@/lib/auth/auth-config";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { members } from "@/lib/db/schema/organization";

const ADMIN_ROLES = new Set(["owner", "admin"]);

type ClientAction =
  | "configure-client-credentials-scopes"
  | "create"
  | "delete"
  | "list"
  | "read"
  | "rotate"
  | "update";

async function findMemberRole(
  organizationId: string,
  userId: string
): Promise<string | null> {
  const member = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(members.userId, userId)
      )
    )
    .limit(1)
    .get();
  return member?.role ?? null;
}

/**
 * RBAC for the OAuth provider's client management endpoints. The provider
 * checks ownership (the registering user or the active organization); this
 * adds that only organization owners and admins manage organization clients.
 */
export async function canManageOAuthClients(input: {
  action: ClientAction;
  organizationId: string | null | undefined;
  userId: string | undefined;
}): Promise<boolean> {
  if (input.action === "configure-client-credentials-scopes") {
    return false;
  }
  if (!input.organizationId) {
    return true;
  }
  if (!input.userId) {
    return false;
  }
  const role = await findMemberRole(input.organizationId, input.userId);
  return role !== null && ADMIN_ROLES.has(role);
}

export async function requireRpAdmin(
  session: Session
): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; response: NextResponse<{ error: string }> }
> {
  const organizationId = (session.session as Record<string, unknown>)
    .activeOrganizationId as string | null;
  if (!organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No active organization set." },
        { status: 400 }
      ),
    };
  }

  const role = await findMemberRole(organizationId, session.user.id);

  if (!role) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You are not a member of the active organization." },
        { status: 403 }
      ),
    };
  }

  if (!ADMIN_ROLES.has(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Organization admin role required." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, organizationId };
}

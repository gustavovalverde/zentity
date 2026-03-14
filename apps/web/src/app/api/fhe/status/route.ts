import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/api-auth";
import {
  getIdentityBundleByUserId,
  updateIdentityBundleFheStatus,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";

export const runtime = "nodejs";

const StatusSchema = z.object({
  fheKeyId: z.string().min(1),
  fheStatus: z.enum(["pending", "complete", "error"]),
  fheError: z.string().nullable().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = StatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { fheKeyId, fheStatus, fheError } = parsed.data;
  const userId = authResult.session.user.id;

  const existing = await getIdentityBundleByUserId(userId);
  if (existing) {
    await updateIdentityBundleFheStatus({
      userId,
      fheKeyId,
      fheStatus,
      fheError: fheError ?? null,
    });
  } else {
    await upsertIdentityBundle({
      userId,
      status: "pending",
      fheKeyId,
      fheStatus,
      fheError: fheError ?? null,
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}

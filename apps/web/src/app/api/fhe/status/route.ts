import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/api-auth";
import { upsertIdentityBundle } from "@/lib/db/queries/identity";
import { withSpan } from "@/lib/observability/telemetry";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { fheLimiter } from "@/lib/utils/rate-limiters";

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

  const { limited, retryAfter } = fheLimiter.check(authResult.session.user.id);
  if (limited) {
    return rateLimitResponse(retryAfter);
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

  return await withSpan(
    "fhe.enrollment.status",
    { "fhe.key_id": fheKeyId, "fhe.status": fheStatus },
    async () => {
      await upsertIdentityBundle({
        userId,
        fheKeyId,
        fheStatus,
        fheError: fheError ?? null,
      });

      return NextResponse.json({ success: true }, { status: 200 });
    }
  );
}

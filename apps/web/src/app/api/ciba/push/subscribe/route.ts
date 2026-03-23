import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import { db } from "@/lib/db/connection";
import { pushSubscriptions } from "@/lib/db/schema/push";
import { rateLimitResponse } from "@/lib/utils/rate-limit";
import { cibaLimiter } from "@/lib/utils/rate-limiters";

export const runtime = "nodejs";
const MAX_SUBSCRIPTIONS = 5;

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    auth: z.string().min(1),
    p256dh: z.string().min(1),
  }),
});

async function enforceSubscriptionLimit(userId: string) {
  const userSubs = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt));

  if (userSubs.length <= MAX_SUBSCRIPTIONS) {
    return;
  }

  const stale = userSubs.slice(MAX_SUBSCRIPTIONS);
  await db.delete(pushSubscriptions).where(
    inArray(
      pushSubscriptions.id,
      stale.map((subscription) => subscription.id)
    )
  );
}

export async function POST(request: Request) {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = cibaLimiter.check(authResult.session.user.id);
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  const body = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid subscription" },
      { status: 400 }
    );
  }

  const { endpoint, keys } = parsed.data;
  const userId = authResult.session.user.id;

  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1)
    .get();

  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        createdAt: new Date(),
      })
      .where(eq(pushSubscriptions.endpoint, endpoint));
  } else {
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  }

  await enforceSubscriptionLimit(userId);

  return NextResponse.json({ ok: true }, { status: 201 });
}

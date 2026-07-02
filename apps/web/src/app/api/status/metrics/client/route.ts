import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getClientIp,
  publicLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import {
  CLIENT_METRIC_DEFINITIONS,
  type ClientMetricName,
} from "@/lib/observability/client-metrics";
import { recordClientMetricServer } from "@/lib/observability/metrics";

export const runtime = "nodejs";

type MetricAttributes = Record<string, string | number | boolean>;

const MAX_EVENTS = 50;
const MAX_DURATION_MS = 5 * 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

const eventSchema = z.object({
  name: z.string(),
  value: z.number().nonnegative(),
  unit: z.enum(["ms", "By"]),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const payloadSchema = z.object({
  events: z.array(eventSchema).max(MAX_EVENTS),
});

function sanitizeAttributes(
  attributes: Record<string, unknown> | undefined,
  allowed: Set<string>
): MetricAttributes | undefined {
  if (!attributes) {
    return;
  }
  const sanitized: MetricAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowed.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      if (!value) {
        continue;
      }
      sanitized[key] = value.length > 64 ? value.slice(0, 64) : value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function isValueWithinLimits(unit: "ms" | "By", value: number): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
  }
  if (unit === "ms") {
    return value <= MAX_DURATION_MS;
  }
  return value <= MAX_BYTES;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { limited, retryAfter } = publicLimiter.check(
    getClientIp(request.headers)
  );
  if (limited) {
    return rateLimitResponse(retryAfter) as NextResponse;
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  for (const event of parsed.data.events) {
    if (!Object.hasOwn(CLIENT_METRIC_DEFINITIONS, event.name)) {
      continue;
    }
    const definition =
      CLIENT_METRIC_DEFINITIONS[event.name as ClientMetricName];
    if (definition.unit !== event.unit) {
      continue;
    }
    if (!isValueWithinLimits(event.unit, event.value)) {
      continue;
    }

    const attrs = sanitizeAttributes(
      event.attributes,
      new Set(definition.attributes)
    );
    recordClientMetricServer(event.name, event.unit, event.value, attrs);
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CLIENT_METRIC_DEFINITIONS,
  type ClientMetricName,
} from "@/lib/observability/client-metric-definitions";
import {
  recordClientFhevmDecryptDuration,
  recordClientFhevmEncryptDuration,
  recordClientFhevmEncryptProofBytes,
  recordClientFhevmInitDuration,
  recordClientNoirProofBytes,
  recordClientNoirProofDuration,
  recordClientPasskeyDuration,
  recordClientTfheKeygenDuration,
  recordClientTfheLoadDuration,
  recordClientTfheLoadRetry,
} from "@/lib/observability/metrics";

export const runtime = "nodejs";

const MAX_EVENTS = 50;
const MAX_DURATION_MS = 5 * 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

const eventSchema = z.object({
  name: z.string(),
  value: z.number().finite().nonnegative(),
  unit: z.enum(["ms", "By"]),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const payloadSchema = z.object({
  events: z.array(eventSchema).max(MAX_EVENTS),
});

const handlers: Record<
  ClientMetricName,
  {
    unit: "ms" | "By";
    record: (
      value: number,
      attributes?: Record<string, string | number | boolean>
    ) => void;
    attributes: Set<string>;
  }
> = {
  "client.noir.proof.duration": {
    unit: "ms",
    record: recordClientNoirProofDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.noir.proof.duration"].attributes
    ),
  },
  "client.noir.proof.bytes": {
    unit: "By",
    record: recordClientNoirProofBytes,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.noir.proof.bytes"].attributes
    ),
  },
  "client.fhevm.encrypt.duration": {
    unit: "ms",
    record: recordClientFhevmEncryptDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.fhevm.encrypt.duration"].attributes
    ),
  },
  "client.fhevm.encrypt.proof.bytes": {
    unit: "By",
    record: recordClientFhevmEncryptProofBytes,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.fhevm.encrypt.proof.bytes"].attributes
    ),
  },
  "client.fhevm.decrypt.duration": {
    unit: "ms",
    record: recordClientFhevmDecryptDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.fhevm.decrypt.duration"].attributes
    ),
  },
  "client.fhevm.init.duration": {
    unit: "ms",
    record: recordClientFhevmInitDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.fhevm.init.duration"].attributes
    ),
  },
  "client.tfhe.load.duration": {
    unit: "ms",
    record: recordClientTfheLoadDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.tfhe.load.duration"].attributes
    ),
  },
  "client.tfhe.load.retry": {
    unit: "ms",
    record: recordClientTfheLoadRetry,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.tfhe.load.retry"].attributes
    ),
  },
  "client.tfhe.keygen.duration": {
    unit: "ms",
    record: recordClientTfheKeygenDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.tfhe.keygen.duration"].attributes
    ),
  },
  "client.passkey.duration": {
    unit: "ms",
    record: recordClientPasskeyDuration,
    attributes: new Set(
      CLIENT_METRIC_DEFINITIONS["client.passkey.duration"].attributes
    ),
  },
};

function sanitizeAttributes(
  attributes: Record<string, unknown> | undefined,
  allowed: Set<string>
): Record<string, string | number | boolean> | undefined {
  if (!attributes) {
    return;
  }
  const sanitized: Record<string, string | number | boolean> = {};
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
  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  for (const event of parsed.data.events) {
    const handler = handlers[event.name as ClientMetricName];
    if (!handler || handler.unit !== event.unit) {
      continue;
    }
    if (!isValueWithinLimits(handler.unit, event.value)) {
      continue;
    }

    const attrs = sanitizeAttributes(event.attributes, handler.attributes);
    handler.record(event.value, attrs);
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}

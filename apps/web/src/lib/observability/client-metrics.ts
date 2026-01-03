"use client";

import {
  CLIENT_METRIC_DEFINITIONS,
  type ClientMetricName,
  type ClientMetricUnit,
} from "@/lib/observability/client-metric-definitions";
import { getOnboardingFlowId } from "@/lib/observability/flow-client";

type MetricAttributes = Record<string, string | number | boolean>;

interface ClientMetricEvent {
  name: ClientMetricName;
  value: number;
  unit: ClientMetricUnit;
  attributes?: MetricAttributes;
}

const ENDPOINT = "/api/metrics/client";
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;

const queue: ClientMetricEvent[] = [];
let flushTimer: number | null = null;
let flushing = false;
let listenersBound = false;

const isBrowser = typeof window !== "undefined";

function normalizeAttributes(
  attributes?: MetricAttributes
): MetricAttributes | undefined {
  if (!attributes) {
    return;
  }
  const out: MetricAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      if (!value) {
        continue;
      }
      out[key] = value.length > 64 ? value.slice(0, 64) : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function getBaseAttributes(): MetricAttributes {
  return { flow_present: Boolean(getOnboardingFlowId()) };
}

function enqueue(event: ClientMetricEvent): void {
  if (!Number.isFinite(event.value) || event.value < 0) {
    return;
  }
  queue.push(event);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }
}

async function flush(): Promise<void> {
  if (!isBrowser || flushing || queue.length === 0) {
    return;
  }
  flushing = true;
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  const payload = JSON.stringify({ events: batch });

  let sent = false;
  if (navigator.sendBeacon) {
    try {
      sent = navigator.sendBeacon(
        ENDPOINT,
        new Blob([payload], { type: "application/json" })
      );
    } catch {
      sent = false;
    }
  }

  if (!sent) {
    try {
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
        credentials: "same-origin",
      });
    } catch {
      // Best-effort; drop metrics on network failures.
    }
  }

  flushing = false;
  if (queue.length > 0) {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (!isBrowser || flushTimer) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flush().catch(() => {
      // ignore flush failures
    });
  }, FLUSH_INTERVAL_MS);
}

function bindListeners(): void {
  if (!isBrowser || listenersBound) {
    return;
  }
  listenersBound = true;
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush().catch(() => {
        // ignore flush failures
      });
    }
  });
  window.addEventListener("pagehide", () => {
    flush().catch(() => {
      // ignore flush failures
    });
  });
}

export function recordClientMetric(input: {
  name: ClientMetricName;
  value: number;
  attributes?: MetricAttributes;
}): void {
  if (!isBrowser) {
    return;
  }
  bindListeners();

  const definition = CLIENT_METRIC_DEFINITIONS[input.name];
  const attributes = normalizeAttributes({
    ...getBaseAttributes(),
    ...(input.attributes ?? {}),
  });

  enqueue({
    name: input.name,
    value: input.value,
    unit: definition.unit,
    attributes,
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    flush().catch(() => {
      // ignore flush failures
    });
  } else {
    scheduleFlush();
  }
}

async function _measureClientDuration<T>(args: {
  name: ClientMetricName;
  attributes?: MetricAttributes;
  run: () => Promise<T> | T;
}): Promise<T> {
  const start = performance.now();
  let result: "ok" | "error" = "ok";

  try {
    return await args.run();
  } catch (error) {
    result = "error";
    throw error;
  } finally {
    recordClientMetric({
      name: args.name,
      value: performance.now() - start,
      attributes: {
        ...args.attributes,
        result,
      },
    });
  }
}

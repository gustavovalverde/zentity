import "server-only";

import { type Attributes, type Histogram, metrics } from "@opentelemetry/api";

import {
  getServiceName,
  getServiceVersion,
} from "@/lib/observability/telemetry";

const meter = metrics.getMeter(getServiceName(), getServiceVersion());

const DURATION_BUCKETS_MS = [
  25, 50, 100, 250, 500, 1000, 2000, 5000, 10_000, 20_000, 40_000, 60_000,
];

const SIZE_BUCKETS_BYTES = [
  512, 1024, 5120, 10_240, 102_400, 512_000, 1_048_576, 5_242_880, 10_485_760,
  20_971_520,
];

const durationAdvice = { explicitBucketBoundaries: DURATION_BUCKETS_MS };
const sizeAdvice = { explicitBucketBoundaries: SIZE_BUCKETS_BYTES };

const livenessDetectDuration = meter.createHistogram(
  "zentity.liveness.detect.duration",
  {
    description: "Human.js server-side face detection duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const ocrRequestDuration = meter.createHistogram(
  "zentity.ocr.request.duration",
  {
    description: "OCR service request duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const ocrPayloadBytes = meter.createHistogram("zentity.ocr.request.bytes", {
  description: "OCR request payload size.",
  unit: "By",
  advice: sizeAdvice,
});

const ocrImageBytes = meter.createHistogram("zentity.ocr.image.bytes", {
  description: "OCR input image size (base64 bytes).",
  unit: "By",
  advice: sizeAdvice,
});

const fheRequestDuration = meter.createHistogram(
  "zentity.fhe.request.duration",
  {
    description: "FHE service request duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const fhePayloadBytes = meter.createHistogram("zentity.fhe.request.bytes", {
  description: "FHE request payload size.",
  unit: "By",
  advice: sizeAdvice,
});

const zkVerifyDuration = meter.createHistogram("zentity.zk.verify.duration", {
  description: "ZK proof verification duration.",
  unit: "ms",
  advice: durationAdvice,
});

function recordSafe(
  histogram: { record: (value: number, attributes?: Attributes) => void },
  value: number,
  attributes?: Attributes
) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  histogram.record(value, attributes);
}

export function recordLivenessDetectDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(livenessDetectDuration, durationMs, attributes);
}

export function recordOcrDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(ocrRequestDuration, durationMs, attributes);
}

export function recordOcrPayloadBytes(
  bytes: number,
  attributes?: Attributes
): void {
  recordSafe(ocrPayloadBytes, bytes, attributes);
}

export function recordOcrImageBytes(
  bytes: number,
  attributes?: Attributes
): void {
  recordSafe(ocrImageBytes, bytes, attributes);
}

export function recordFheDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(fheRequestDuration, durationMs, attributes);
}

export function recordFhePayloadBytes(
  bytes: number,
  attributes?: Attributes
): void {
  recordSafe(fhePayloadBytes, bytes, attributes);
}

export function recordZkVerifyDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(zkVerifyDuration, durationMs, attributes);
}

const clientHistograms = new Map<string, Histogram>();

/**
 * Record a client-reported metric into a lazily-created histogram named
 * `zentity.{name}`, bucketed by unit. The metric registry
 * (CLIENT_METRIC_DEFINITIONS) is validated at the ingest route.
 */
export function recordClientMetricServer(
  name: string,
  unit: "ms" | "By",
  value: number,
  attributes?: Attributes
): void {
  let histogram = clientHistograms.get(name);
  if (!histogram) {
    histogram = meter.createHistogram(`zentity.${name}`, {
      unit,
      advice: unit === "By" ? sizeAdvice : durationAdvice,
    });
    clientHistograms.set(name, histogram);
  }
  recordSafe(histogram, value, attributes);
}

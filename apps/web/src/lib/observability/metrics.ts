import "server-only";

import { type MetricAttributes, metrics } from "@opentelemetry/api";

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

const clientNoirProofDuration = meter.createHistogram(
  "zentity.client.noir.proof.duration",
  {
    description: "Client-side Noir proof generation duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientNoirProofBytes = meter.createHistogram(
  "zentity.client.noir.proof.bytes",
  {
    description: "Client-side Noir proof size.",
    unit: "By",
    advice: sizeAdvice,
  }
);

const clientFhevmEncryptDuration = meter.createHistogram(
  "zentity.client.fhevm.encrypt.duration",
  {
    description: "Client-side FHEVM encryption duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientFhevmEncryptProofBytes = meter.createHistogram(
  "zentity.client.fhevm.encrypt.proof.bytes",
  {
    description: "Client-side FHEVM encryption proof size.",
    unit: "By",
    advice: sizeAdvice,
  }
);

const clientFhevmDecryptDuration = meter.createHistogram(
  "zentity.client.fhevm.decrypt.duration",
  {
    description: "Client-side FHEVM decrypt duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientFhevmInitDuration = meter.createHistogram(
  "zentity.client.fhevm.init.duration",
  {
    description: "Client-side FHEVM SDK initialization duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientTfheLoadDuration = meter.createHistogram(
  "zentity.client.tfhe.load.duration",
  {
    description: "Client-side TFHE WASM load duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientTfheKeygenDuration = meter.createHistogram(
  "zentity.client.tfhe.keygen.duration",
  {
    description: "Client-side TFHE key generation duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientPasskeyDuration = meter.createHistogram(
  "zentity.client.passkey.duration",
  {
    description: "Client-side passkey operation duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

function recordSafe(
  histogram: { record: (value: number, attributes?: MetricAttributes) => void },
  value: number,
  attributes?: MetricAttributes
) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  histogram.record(value, attributes);
}

export function recordLivenessDetectDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(livenessDetectDuration, durationMs, attributes);
}

export function recordOcrDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(ocrRequestDuration, durationMs, attributes);
}

export function recordOcrPayloadBytes(
  bytes: number,
  attributes?: MetricAttributes
): void {
  recordSafe(ocrPayloadBytes, bytes, attributes);
}

export function recordOcrImageBytes(
  bytes: number,
  attributes?: MetricAttributes
): void {
  recordSafe(ocrImageBytes, bytes, attributes);
}

export function recordFheDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(fheRequestDuration, durationMs, attributes);
}

export function recordFhePayloadBytes(
  bytes: number,
  attributes?: MetricAttributes
): void {
  recordSafe(fhePayloadBytes, bytes, attributes);
}

export function recordZkVerifyDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(zkVerifyDuration, durationMs, attributes);
}

export function recordClientNoirProofDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientNoirProofDuration, durationMs, attributes);
}

export function recordClientNoirProofBytes(
  bytes: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientNoirProofBytes, bytes, attributes);
}

export function recordClientFhevmEncryptDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientFhevmEncryptDuration, durationMs, attributes);
}

export function recordClientFhevmEncryptProofBytes(
  bytes: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientFhevmEncryptProofBytes, bytes, attributes);
}

export function recordClientFhevmDecryptDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientFhevmDecryptDuration, durationMs, attributes);
}

export function recordClientFhevmInitDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientFhevmInitDuration, durationMs, attributes);
}

export function recordClientTfheLoadDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientTfheLoadDuration, durationMs, attributes);
}

export function recordClientTfheKeygenDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientTfheKeygenDuration, durationMs, attributes);
}

export function recordClientPasskeyDuration(
  durationMs: number,
  attributes?: MetricAttributes
): void {
  recordSafe(clientPasskeyDuration, durationMs, attributes);
}

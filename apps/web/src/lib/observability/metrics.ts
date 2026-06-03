import "server-only";

import { type Attributes, metrics } from "@opentelemetry/api";

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

const clientConfidentialEncryptDuration = meter.createHistogram(
  "zentity.client.confidential.encrypt.duration",
  {
    description: "Client-side confidential encryption duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientConfidentialEncryptProofBytes = meter.createHistogram(
  "zentity.client.confidential.encrypt.proof.bytes",
  {
    description: "Client-side confidential encryption proof size.",
    unit: "By",
    advice: sizeAdvice,
  }
);

const clientConfidentialDecryptDuration = meter.createHistogram(
  "zentity.client.confidential.decrypt.duration",
  {
    description: "Client-side confidential decrypt duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientConfidentialInitDuration = meter.createHistogram(
  "zentity.client.confidential.init.duration",
  {
    description: "Client-side confidential SDK initialization duration.",
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

const clientTfheLoadRetry = meter.createHistogram(
  "zentity.client.tfhe.load.retry",
  {
    description: "Client-side TFHE WASM load retry delay.",
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

const clientOpaqueDuration = meter.createHistogram(
  "zentity.client.opaque.duration",
  {
    description: "Client-side OPAQUE authentication duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientWalletSignDuration = meter.createHistogram(
  "zentity.client.wallet.sign.duration",
  {
    description: "Client-side wallet signature duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientFheEnrollmentStageDuration = meter.createHistogram(
  "zentity.client.fhe.enrollment.stage.duration",
  {
    description: "Client-side FHE enrollment per-stage duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientFheEnrollmentTotalDuration = meter.createHistogram(
  "zentity.client.fhe.enrollment.total.duration",
  {
    description: "Client-side FHE enrollment total duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientTfheKeygenWorkerDuration = meter.createHistogram(
  "zentity.client.tfhe.keygen.worker.duration",
  {
    description: "Client-side TFHE key generation duration (worker-internal).",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientTfheInitDuration = meter.createHistogram(
  "zentity.client.tfhe.init.duration",
  {
    description: "Client-side TFHE WASM init duration (prewarm).",
    unit: "ms",
    advice: durationAdvice,
  }
);

const clientTfheBgKeygenDuration = meter.createHistogram(
  "zentity.client.tfhe.bg_keygen.duration",
  {
    description: "Background FHE key generation + registration duration.",
    unit: "ms",
    advice: durationAdvice,
  }
);

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

export function recordClientNoirProofDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientNoirProofDuration, durationMs, attributes);
}

export function recordClientNoirProofBytes(
  bytes: number,
  attributes?: Attributes
): void {
  recordSafe(clientNoirProofBytes, bytes, attributes);
}

export function recordClientConfidentialEncryptDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientConfidentialEncryptDuration, durationMs, attributes);
}

export function recordClientConfidentialEncryptProofBytes(
  bytes: number,
  attributes?: Attributes
): void {
  recordSafe(clientConfidentialEncryptProofBytes, bytes, attributes);
}

export function recordClientConfidentialDecryptDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientConfidentialDecryptDuration, durationMs, attributes);
}

export function recordClientConfidentialInitDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientConfidentialInitDuration, durationMs, attributes);
}

export function recordClientTfheLoadDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheLoadDuration, durationMs, attributes);
}

export function recordClientTfheLoadRetry(
  delayMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheLoadRetry, delayMs, attributes);
}

export function recordClientTfheKeygenDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheKeygenDuration, durationMs, attributes);
}

export function recordClientPasskeyDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientPasskeyDuration, durationMs, attributes);
}

export function recordClientOpaqueDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientOpaqueDuration, durationMs, attributes);
}

export function recordClientWalletSignDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientWalletSignDuration, durationMs, attributes);
}

export function recordClientFheEnrollmentStageDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientFheEnrollmentStageDuration, durationMs, attributes);
}

export function recordClientFheEnrollmentTotalDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientFheEnrollmentTotalDuration, durationMs, attributes);
}

export function recordClientTfheKeygenWorkerDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheKeygenWorkerDuration, durationMs, attributes);
}

export function recordClientTfheInitDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheInitDuration, durationMs, attributes);
}

export function recordClientTfheBgKeygenDuration(
  durationMs: number,
  attributes?: Attributes
): void {
  recordSafe(clientTfheBgKeygenDuration, durationMs, attributes);
}

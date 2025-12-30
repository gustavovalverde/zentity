import "server-only";

import { hashIdentifier, withSpan } from "@/lib/observability";
import { fetchJson, HttpError } from "@/lib/utils";
import { getFheServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(
  requestId?: string,
): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers["X-Zentity-Internal-Token"] = token;
  if (requestId) headers["X-Request-Id"] = requestId;
  return headers;
}

export type FheOperation =
  | "register_key"
  | "encrypt_birth_year_offset"
  | "encrypt_country_code"
  | "encrypt_compliance_level"
  | "encrypt_liveness"
  | "verify_age_offset"
  | "verify_liveness_threshold";

export class FheServiceError extends Error {
  readonly operation: FheOperation;
  readonly kind: "http" | "timeout" | "network" | "unknown";
  readonly status?: number;
  readonly bodyText?: string;

  constructor(args: {
    operation: FheOperation;
    message: string;
    kind: "http" | "timeout" | "network" | "unknown";
    status?: number;
    bodyText?: string;
  }) {
    super(args.message);
    this.name = "FheServiceError";
    this.operation = args.operation;
    this.kind = args.kind;
    this.status = args.status;
    this.bodyText = args.bodyText;
  }
}

async function withFheError<T>(
  operation: FheOperation,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FheServiceError) {
      throw error;
    }
    if (error instanceof HttpError) {
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "http",
        status: error.status,
        bodyText: error.bodyText,
      });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "timeout",
      });
    }
    if (error instanceof Error) {
      throw new FheServiceError({
        operation,
        message: error.message,
        kind: "network",
      });
    }
    throw new FheServiceError({
      operation,
      message: "Unknown FHE service error",
      kind: "unknown",
    });
  }
}

interface FheCiphertextResult {
  ciphertext: string;
}

interface FheEncryptLivenessResult extends FheCiphertextResult {
  score: number;
}

interface FheVerifyAgeResult {
  resultCiphertext: string;
}

interface FheVerifyLivenessThresholdResult {
  passesCiphertext: string;
  threshold: number;
}

interface FheRegisterKeyResult {
  keyId: string;
}

export async function encryptBirthYearOffsetFhe(args: {
  birthYearOffset: number;
  publicKey: string;
  requestId?: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-birth-year-offset`;
  const payload = JSON.stringify({
    birthYearOffset: args.birthYearOffset,
    publicKey: args.publicKey,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const publicKeyBytes = Buffer.byteLength(args.publicKey);
  return withFheError("encrypt_birth_year_offset", () =>
    withSpan(
      "fhe.encrypt_birth_year_offset",
      {
        "fhe.operation": "encrypt_birth_year_offset",
        "fhe.request_bytes": payloadBytes,
        "fhe.public_key_bytes": publicKeyBytes,
      },
      () =>
        fetchJson<FheCiphertextResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function encryptCountryCodeFhe(args: {
  countryCode: number;
  publicKey: string;
  requestId?: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-country-code`;
  const payload = JSON.stringify({
    countryCode: args.countryCode,
    publicKey: args.publicKey,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const publicKeyBytes = Buffer.byteLength(args.publicKey);
  return withFheError("encrypt_country_code", () =>
    withSpan(
      "fhe.encrypt_country_code",
      {
        "fhe.operation": "encrypt_country_code",
        "fhe.request_bytes": payloadBytes,
        "fhe.public_key_bytes": publicKeyBytes,
      },
      () =>
        fetchJson<FheCiphertextResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function encryptComplianceLevelFhe(args: {
  complianceLevel: number;
  publicKey: string;
  requestId?: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-compliance-level`;
  const payload = JSON.stringify({
    complianceLevel: args.complianceLevel,
    publicKey: args.publicKey,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const publicKeyBytes = Buffer.byteLength(args.publicKey);
  return withFheError("encrypt_compliance_level", () =>
    withSpan(
      "fhe.encrypt_compliance_level",
      {
        "fhe.operation": "encrypt_compliance_level",
        "fhe.request_bytes": payloadBytes,
        "fhe.public_key_bytes": publicKeyBytes,
      },
      () =>
        fetchJson<FheCiphertextResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function encryptLivenessScoreFhe(args: {
  score: number;
  publicKey: string;
  requestId?: string;
}): Promise<FheEncryptLivenessResult> {
  const url = `${getFheServiceUrl()}/encrypt-liveness`;
  const payload = JSON.stringify({
    score: args.score,
    publicKey: args.publicKey,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const publicKeyBytes = Buffer.byteLength(args.publicKey);
  return withFheError("encrypt_liveness", () =>
    withSpan(
      "fhe.encrypt_liveness",
      {
        "fhe.operation": "encrypt_liveness",
        "fhe.request_bytes": payloadBytes,
        "fhe.public_key_bytes": publicKeyBytes,
      },
      () =>
        fetchJson<FheEncryptLivenessResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function registerFheKey(args: {
  serverKey: string;
  requestId?: string;
}): Promise<FheRegisterKeyResult> {
  const url = `${getFheServiceUrl()}/keys/register`;
  const payload = JSON.stringify({ serverKey: args.serverKey });
  const payloadBytes = Buffer.byteLength(payload);
  const serverKeyBytes = Buffer.byteLength(args.serverKey);
  return withFheError("register_key", () =>
    withSpan(
      "fhe.register_key",
      {
        "fhe.operation": "register_key",
        "fhe.request_bytes": payloadBytes,
        "fhe.server_key_bytes": serverKeyBytes,
      },
      () =>
        fetchJson<FheRegisterKeyResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function verifyAgeFhe(args: {
  ciphertext: string;
  currentYear: number;
  minAge: number;
  keyId: string;
  requestId?: string;
}): Promise<FheVerifyAgeResult> {
  const url = `${getFheServiceUrl()}/verify-age-offset`;
  const payload = JSON.stringify({
    ciphertext: args.ciphertext,
    currentYear: args.currentYear,
    minAge: args.minAge,
    keyId: args.keyId,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const ciphertextBytes = Buffer.byteLength(args.ciphertext);
  return withFheError("verify_age_offset", () =>
    withSpan(
      "fhe.verify_age_offset",
      {
        "fhe.operation": "verify_age_offset",
        "fhe.request_bytes": payloadBytes,
        "fhe.ciphertext_bytes": ciphertextBytes,
        "fhe.key_id_hash": hashIdentifier(args.keyId),
      },
      () =>
        fetchJson<FheVerifyAgeResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

export async function verifyLivenessThresholdFhe(args: {
  ciphertext: string;
  threshold: number;
  keyId: string;
  requestId?: string;
}): Promise<FheVerifyLivenessThresholdResult> {
  const url = `${getFheServiceUrl()}/verify-liveness-threshold`;
  const payload = JSON.stringify({
    ciphertext: args.ciphertext,
    threshold: args.threshold,
    keyId: args.keyId,
  });
  const payloadBytes = Buffer.byteLength(payload);
  const ciphertextBytes = Buffer.byteLength(args.ciphertext);
  return withFheError("verify_liveness_threshold", () =>
    withSpan(
      "fhe.verify_liveness_threshold",
      {
        "fhe.operation": "verify_liveness_threshold",
        "fhe.request_bytes": payloadBytes,
        "fhe.ciphertext_bytes": ciphertextBytes,
        "fhe.key_id_hash": hashIdentifier(args.keyId),
      },
      () =>
        fetchJson<FheVerifyLivenessThresholdResult>(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalServiceAuthHeaders(args.requestId),
          },
          body: payload,
        }),
    ),
  );
}

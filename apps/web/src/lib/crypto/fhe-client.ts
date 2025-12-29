import "server-only";

import { fetchJson, HttpError } from "@/lib/utils";
import { getFheServiceUrl } from "@/lib/utils/service-urls";

function getInternalServiceAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) return {};
  return { "X-Zentity-Internal-Token": token };
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
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-birth-year-offset`;
  return withFheError("encrypt_birth_year_offset", () =>
    fetchJson<FheCiphertextResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        birthYearOffset: args.birthYearOffset,
        publicKey: args.publicKey,
      }),
    }),
  );
}

export async function encryptCountryCodeFhe(args: {
  countryCode: number;
  publicKey: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-country-code`;
  return withFheError("encrypt_country_code", () =>
    fetchJson<FheCiphertextResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        countryCode: args.countryCode,
        publicKey: args.publicKey,
      }),
    }),
  );
}

export async function encryptComplianceLevelFhe(args: {
  complianceLevel: number;
  publicKey: string;
}): Promise<FheCiphertextResult> {
  const url = `${getFheServiceUrl()}/encrypt-compliance-level`;
  return withFheError("encrypt_compliance_level", () =>
    fetchJson<FheCiphertextResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        complianceLevel: args.complianceLevel,
        publicKey: args.publicKey,
      }),
    }),
  );
}

export async function encryptLivenessScoreFhe(args: {
  score: number;
  publicKey: string;
}): Promise<FheEncryptLivenessResult> {
  const url = `${getFheServiceUrl()}/encrypt-liveness`;
  return withFheError("encrypt_liveness", () =>
    fetchJson<FheEncryptLivenessResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        score: args.score,
        publicKey: args.publicKey,
      }),
    }),
  );
}

export async function registerFheKey(args: {
  serverKey: string;
}): Promise<FheRegisterKeyResult> {
  const url = `${getFheServiceUrl()}/keys/register`;
  return withFheError("register_key", () =>
    fetchJson<FheRegisterKeyResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        serverKey: args.serverKey,
      }),
    }),
  );
}

export async function verifyAgeFhe(args: {
  ciphertext: string;
  currentYear: number;
  minAge: number;
  keyId: string;
}): Promise<FheVerifyAgeResult> {
  const url = `${getFheServiceUrl()}/verify-age-offset`;
  return withFheError("verify_age_offset", () =>
    fetchJson<FheVerifyAgeResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        ciphertext: args.ciphertext,
        currentYear: args.currentYear,
        minAge: args.minAge,
        keyId: args.keyId,
      }),
    }),
  );
}

export async function verifyLivenessThresholdFhe(args: {
  ciphertext: string;
  threshold: number;
  keyId: string;
}): Promise<FheVerifyLivenessThresholdResult> {
  const url = `${getFheServiceUrl()}/verify-liveness-threshold`;
  return withFheError("verify_liveness_threshold", () =>
    fetchJson<FheVerifyLivenessThresholdResult>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        ciphertext: args.ciphertext,
        threshold: args.threshold,
        keyId: args.keyId,
      }),
    }),
  );
}

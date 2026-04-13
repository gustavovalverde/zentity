/**
 * Server-Side ZKPassport Proof Verification
 *
 * Cached, pre-warmed verification pipeline for NFC chip proofs.
 * Replaces the SDK's `verify()` which re-creates expensive resources
 * (WASM backend, CDN fetches, RPC calls) on every invocation.
 *
 * Uses the SDK's own exported utility functions from @zkpassport/utils
 * for public input validation — no cryptographic reimplementation.
 */

import "server-only";

import type {
  CircuitManifest,
  PackagedCircuit,
  ProofResult,
  QueryResult,
} from "@zkpassport/utils";

import { UltraHonkVerifierBackend } from "@aztec/bb.js";
import { RegistryClient } from "@zkpassport/registry";
import {
  areDatesEqual,
  DisclosedData,
  formatBoundData,
  formatName,
  formatQueryResultDates,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getBirthdateMaxDateTimestamp,
  getBirthdateMinDateTimestamp,
  getCertificateRegistryRootFromOuterProof,
  getCircuitRegistryRootFromOuterProof,
  getCommitmentFromDSCProof,
  getCommitmentInFromDisclosureProof,
  getCommitmentInFromIDDataProof,
  getCommitmentInFromIntegrityProof,
  getCommitmentOutFromIDDataProof,
  getCommitmentOutFromIntegrityProof,
  getCountryParameterCommitment,
  getCurrentDateFromDisclosureProof,
  getCurrentDateFromOuterProof,
  getDateParameterCommitment,
  getDiscloseParameterCommitment,
  getFacematchParameterCommitment,
  getMaxAgeFromCommittedInputs,
  getMaxDateFromCommittedInputs,
  getMerkleRootFromDSCProof,
  getMinAgeFromCommittedInputs,
  getMinDateFromCommittedInputs,
  getNullifierFromDisclosureProof,
  getNullifierFromOuterProof,
  getNullifierTypeFromDisclosureProof,
  getNullifierTypeFromOuterProof,
  getNumberOfPublicInputs,
  getParamCommitmentsFromOuterProof,
  getParameterCommitmentFromDisclosureProof,
  getProofData,
  getScopeFromOuterProof,
  getScopeHash,
  getServiceScopeFromDisclosureProof,
  getServiceScopeHash,
  getServiceSubScopeFromDisclosureProof,
  getServiceSubscopeHash,
  getSubscopeFromOuterProof,
  NullifierType,
  ProofType,
  SanctionsBuilder,
  SECONDS_BETWEEN_1900_AND_1970,
} from "@zkpassport/utils";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";
import { getBarretenberg } from "@/lib/privacy/primitives/barretenberg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifyParams {
  devMode?: boolean;
  domain: string;
  proofs: ProofResult[];
  queryResult: QueryResult;
  scope?: string;
  timeoutMs?: number;
  validity?: number;
}

interface VerifyResult {
  queryResultErrors: Record<string, unknown> | undefined;
  uniqueIdentifier: string | undefined;
  uniqueIdentifierType: NullifierType | undefined;
  verificationTimeMs: number;
  verified: boolean;
}

interface RootCacheEntry {
  expiresAt: number;
  valid: boolean;
}

interface QueryResultValidation {
  errors: Record<string, unknown>;
  isCorrect: boolean;
}

interface ProofCoverage {
  age: boolean;
  bind: boolean;
  compareBirthdate: boolean;
  compareExpiry: boolean;
  discloseBytes: boolean;
  facematch: boolean;
  issuingCountryExclusion: boolean;
  issuingCountryInclusion: boolean;
  nationalityExclusion: boolean;
  nationalityInclusion: boolean;
  sanctions: boolean;
}

// ---------------------------------------------------------------------------
// Module-scope singletons and caches
// ---------------------------------------------------------------------------

const DEFAULT_VALIDITY_SECONDS = 604_800; // 7 days
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ZERO_DATE = new Date(0);
const FACEMATCH_ALLOWED_APP_IDS = new Set([
  "0x1fa73686cf510f8f85757b0602de0dd72a13e68ae2092462be8b72662e7f179b",
  "0x24d9929b248be7eeecaa98e105c034a50539610f3fdd4cb9c8983ef4100d615d",
]);
const FACEMATCH_ALLOWED_ROOT_KEYS = new Set([
  "0x2532418a107c5306fa8308c22255792cf77e4a290cbce8a840a642a3e591340b",
  "0x16700a2d9168a194fc85f237af5829b5a2be05b8ae8ac4879ada34cf54a9c211",
  "0x0e1889bec6c1d686abcf08360ff404f803ab345881ea8cba6aad33b7f7f7ffe0",
]);
const ROOT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SEPOLIA_CHAIN_ID = 11_155_111;

let verifierBackend: UltraHonkVerifierBackend | null = null;
let backendInitPromise: Promise<UltraHonkVerifierBackend> | null = null;
let registryClient: RegistryClient | null = null;
let prewarmPromise: Promise<void> | null = null;

const manifestCache = new Map<string, Promise<CircuitManifest>>();
const vkCache = new Map<string, Promise<Uint8Array>>();
const rootValidityCache = new Map<string, RootCacheEntry>();

/** Canonical proof sort order — matches the SDK's checkPublicInputs. */
const PROOF_SORT_ORDER = [
  "sig_check_dsc",
  "sig_check_id_data",
  "data_check_integrity",
  "disclose_bytes",
  "compare_age",
  "compare_birthdate",
  "compare_expiry",
  "exclusion_check_nationality",
  "inclusion_check_nationality",
  "exclusion_check_issuing_country",
  "inclusion_check_issuing_country",
  "bind",
  "exclusion_check_sanctions",
  "facematch",
];

// ---------------------------------------------------------------------------
// Singleton accessors
// ---------------------------------------------------------------------------

function getRegistry(): RegistryClient {
  registryClient ??= new RegistryClient({ chainId: SEPOLIA_CHAIN_ID });
  return registryClient;
}

function getVerifierBackend(): Promise<UltraHonkVerifierBackend> {
  if (verifierBackend) {
    return Promise.resolve(verifierBackend);
  }
  if (backendInitPromise) {
    return backendInitPromise;
  }

  backendInitPromise = (async () => {
    const api = await getBarretenberg();
    const backend = new UltraHonkVerifierBackend(api);
    verifierBackend = backend;
    return backend;
  })();

  backendInitPromise.catch(() => {
    backendInitPromise = null;
  });

  return backendInitPromise;
}

// ---------------------------------------------------------------------------
// Caching helpers
// ---------------------------------------------------------------------------

function getCachedManifest(version: string): Promise<CircuitManifest> {
  let promise = manifestCache.get(version);
  if (!promise) {
    promise = getRegistry().getCircuitManifest(undefined, { version });
    manifestCache.set(version, promise);
    promise.catch(() => manifestCache.delete(version));
  }
  return promise;
}

function getCachedVk(
  circuitName: string,
  manifest: CircuitManifest
): Promise<Uint8Array> {
  const cacheKey = `${circuitName}:${manifest.root}`;
  let promise = vkCache.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const circuit: PackagedCircuit = await getRegistry().getPackagedCircuit(
        circuitName,
        manifest
      );
      return Buffer.from(circuit.vkey, "base64");
    })();
    vkCache.set(cacheKey, promise);
    promise.catch(() => vkCache.delete(cacheKey));
  }
  return promise;
}

async function validateRootOnChain(
  type: "certificate" | "circuit",
  root: string
): Promise<boolean> {
  const cacheKey = `${type}:${root}`;
  const cached = rootValidityCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.valid;
  }

  const registry = getRegistry();
  let valid: boolean;
  try {
    valid =
      type === "certificate"
        ? await registry.isCertificateRootValid(root)
        : await registry.isCircuitRootValid(root);
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        root,
        type,
      },
      "ZKPassport registry root validation failed"
    );
    return false;
  }

  rootValidityCache.set(cacheKey, {
    valid,
    expiresAt: Date.now() + ROOT_CACHE_TTL_MS,
  });
  return valid;
}

// ---------------------------------------------------------------------------
// Public input validation
// ---------------------------------------------------------------------------

interface PublicInputResult {
  errors: Record<string, unknown>;
  isCorrect: boolean;
  nullifier: string | undefined;
  nullifierType: NullifierType | undefined;
}

function sortProofs(proofs: ProofResult[]): ProofResult[] {
  return [...proofs].sort((a, b) => {
    const nameA = a.name ?? "";
    const nameB = b.name ?? "";
    const idxA = PROOF_SORT_ORDER.findIndex((prefix) =>
      nameA.startsWith(prefix)
    );
    const idxB = PROOF_SORT_ORDER.findIndex((prefix) =>
      nameB.startsWith(prefix)
    );
    return idxA - idxB;
  });
}

function addError(
  errors: Record<string, unknown>,
  category: string,
  field: string,
  expected: string,
  received: string,
  message: string
): void {
  const existing =
    (errors[category] as Record<string, unknown> | undefined) ?? {};
  errors[category] = { ...existing, [field]: { expected, received, message } };
}

function todayMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function addStructuredError(
  errors: Record<string, unknown>,
  category: string,
  field: string,
  expected: unknown,
  received: unknown,
  message: string
): void {
  addError(
    errors,
    category,
    field,
    formatErrorValue(expected),
    formatErrorValue(received),
    message
  );
}

function formatErrorValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatErrorValue(entry)).join(", ")}]`;
  }
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function mergeValidationErrors(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): void {
  for (const [category, details] of Object.entries(source)) {
    if (
      details &&
      typeof details === "object" &&
      !Array.isArray(details) &&
      target[category] &&
      typeof target[category] === "object" &&
      !Array.isArray(target[category])
    ) {
      target[category] = {
        ...(target[category] as Record<string, unknown>),
        ...(details as Record<string, unknown>),
      };
      continue;
    }

    target[category] = details;
  }
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasAnyKey(
  value: Record<string, unknown> | undefined,
  keys: readonly string[]
): boolean {
  return Boolean(value && keys.some((key) => key in value));
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return formatName(value).toLowerCase();
}

function checkDateDisclosure(
  errors: Record<string, unknown>,
  category: string,
  field: string,
  expected: unknown,
  primary: Date | undefined,
  fallback: Date | undefined,
  message: string
): boolean {
  if (!(expected instanceof Date)) {
    return false;
  }

  if (
    (primary && areDatesEqual(expected, primary)) ||
    (fallback && areDatesEqual(expected, fallback))
  ) {
    return true;
  }

  addStructuredError(
    errors,
    category,
    field,
    expected,
    primary ?? fallback,
    message
  );
  return false;
}

function checkStringDisclosure(
  errors: Record<string, unknown>,
  category: string,
  field: string,
  expected: unknown,
  primary: string | undefined,
  fallback: string | undefined,
  message: string,
  normalize = false
): boolean {
  if (typeof expected !== "string") {
    return false;
  }

  const normalizedExpected = normalize ? normalizeName(expected) : expected;
  const normalizedPrimary = normalize ? normalizeName(primary) : primary;
  const normalizedFallback = normalize ? normalizeName(fallback) : fallback;

  if (
    normalizedExpected !== undefined &&
    (normalizedExpected === normalizedPrimary ||
      normalizedExpected === normalizedFallback)
  ) {
    return true;
  }

  addStructuredError(
    errors,
    category,
    field,
    expected,
    primary ?? fallback,
    message
  );
  return false;
}

function validateDiscloseBytesQueryResult(
  ci: Record<string, Record<string, unknown>> | undefined,
  queryResult: QueryResult
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  let isCorrect = true;

  const discloseInputs =
    (ci?.disclose_bytes as
      | { discloseMask?: number[]; disclosedBytes?: number[] }
      | undefined) ??
    (ci?.disclose_bytes_evm as
      | { discloseMask?: number[]; disclosedBytes?: number[] }
      | undefined);

  const disclosedBytes = discloseInputs?.disclosedBytes;
  if (!disclosedBytes) {
    return { errors, isCorrect: false };
  }

  const passportData = DisclosedData.fromDisclosedBytes(
    disclosedBytes,
    "passport"
  );
  const idCardData = DisclosedData.fromDisclosedBytes(
    disclosedBytes,
    "id_card"
  );

  if (
    queryResult.document_type?.eq?.result &&
    !checkStringDisclosure(
      errors,
      "document_type",
      "eq",
      queryResult.document_type.eq.expected,
      passportData.documentType,
      idCardData.documentType,
      "Document type does not match the expected document type"
    )
  ) {
    isCorrect = false;
  }
  if (
    queryResult.document_type?.disclose &&
    !checkStringDisclosure(
      errors,
      "document_type",
      "disclose",
      queryResult.document_type.disclose.result,
      passportData.documentType,
      idCardData.documentType,
      "Document type does not match the disclosed document type in query result"
    )
  ) {
    isCorrect = false;
  }

  if (
    queryResult.birthdate?.eq?.result &&
    !checkDateDisclosure(
      errors,
      "birthdate",
      "eq",
      queryResult.birthdate.eq.expected,
      passportData.dateOfBirth,
      idCardData.dateOfBirth,
      "Birthdate does not match the expected birthdate"
    )
  ) {
    isCorrect = false;
  }
  if (
    queryResult.birthdate?.disclose &&
    !checkDateDisclosure(
      errors,
      "birthdate",
      "disclose",
      queryResult.birthdate.disclose.result,
      passportData.dateOfBirth,
      idCardData.dateOfBirth,
      "Birthdate does not match the disclosed birthdate in query result"
    )
  ) {
    isCorrect = false;
  }

  if (
    queryResult.expiry_date?.eq?.result &&
    !checkDateDisclosure(
      errors,
      "expiry_date",
      "eq",
      queryResult.expiry_date.eq.expected,
      passportData.dateOfExpiry,
      idCardData.dateOfExpiry,
      "Expiry date does not match the expected expiry date"
    )
  ) {
    isCorrect = false;
  }
  if (
    queryResult.expiry_date?.disclose &&
    !checkDateDisclosure(
      errors,
      "expiry_date",
      "disclose",
      queryResult.expiry_date.disclose.result,
      passportData.dateOfExpiry,
      idCardData.dateOfExpiry,
      "Expiry date does not match the disclosed expiry date in query result"
    )
  ) {
    isCorrect = false;
  }

  const stringDisclosures = [
    [
      "nationality",
      passportData.nationality,
      idCardData.nationality,
      "Nationality does not match the expected nationality",
      "Nationality does not match the disclosed nationality in query result",
      false,
    ],
    [
      "document_number",
      passportData.documentNumber,
      idCardData.documentNumber,
      "Document number does not match the expected document number",
      "Document number does not match the disclosed document number in query result",
      false,
    ],
    [
      "gender",
      passportData.gender,
      idCardData.gender,
      "Gender does not match the expected gender",
      "Gender does not match the disclosed gender in query result",
      false,
    ],
    [
      "issuing_country",
      passportData.issuingCountry,
      idCardData.issuingCountry,
      "Issuing country does not match the expected issuing country",
      "Issuing country does not match the disclosed issuing country in query result",
      false,
    ],
    [
      "fullname",
      passportData.name,
      idCardData.name,
      "Fullname does not match the expected fullname",
      "Fullname does not match the disclosed fullname in query result",
      true,
    ],
    [
      "firstname",
      passportData.firstName && passportData.firstName.length > 0
        ? passportData.firstName
        : passportData.name,
      idCardData.firstName && idCardData.firstName.length > 0
        ? idCardData.firstName
        : idCardData.name,
      "Firstname does not match the expected firstname",
      "Firstname does not match the disclosed firstname in query result",
      true,
    ],
    [
      "lastname",
      passportData.lastName && passportData.lastName.length > 0
        ? passportData.lastName
        : passportData.name,
      idCardData.lastName && idCardData.lastName.length > 0
        ? idCardData.lastName
        : idCardData.name,
      "Lastname does not match the expected lastname",
      "Lastname does not match the disclosed lastname in query result",
      true,
    ],
  ] as const;

  for (const [
    fieldName,
    primary,
    fallback,
    eqMessage,
    discloseMessage,
    normalize,
  ] of stringDisclosures) {
    const value = queryResult[fieldName as keyof QueryResult];
    if (!hasRecord(value)) {
      continue;
    }

    const valueRecord = value as Record<string, unknown>;
    const eq = hasRecord(valueRecord.eq) ? valueRecord.eq : undefined;
    if (eq?.result === true) {
      const ok = checkStringDisclosure(
        errors,
        fieldName,
        "eq",
        eq.expected,
        primary,
        fallback,
        eqMessage,
        normalize
      );
      isCorrect = isCorrect && ok;
    }

    const disclose = hasRecord(valueRecord.disclose)
      ? valueRecord.disclose
      : undefined;
    if (disclose) {
      const ok = checkStringDisclosure(
        errors,
        fieldName,
        "disclose",
        disclose.result,
        primary,
        fallback,
        discloseMessage,
        normalize
      );
      isCorrect = isCorrect && ok;
    }
  }

  return { errors, isCorrect };
}

function validateAgeQueryResult(
  ci: Record<string, Record<string, unknown>> | undefined,
  queryResult: QueryResult
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  const ageResult = queryResult.age;
  if (!ageResult) {
    addStructuredError(
      errors,
      "age",
      "disclose",
      "present",
      "missing",
      "Age is not set in the query result"
    );
    return { errors, isCorrect: false };
  }

  let isCorrect = true;
  const ageInputs =
    (ci?.compare_age as { minAge: number; maxAge: number } | undefined) ??
    (ci?.compare_age_evm as { minAge: number; maxAge: number } | undefined);

  if (!ageInputs) {
    addStructuredError(
      errors,
      "age",
      "proof",
      "compare_age",
      "missing",
      "Age result was provided without committed age inputs"
    );
    return { errors, isCorrect: false };
  }

  const minAge = getMinAgeFromCommittedInputs(ageInputs);
  const maxAge = getMaxAgeFromCommittedInputs(ageInputs);

  if (ageResult.gte?.result && minAge !== ageResult.gte.expected) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "gte",
      ageResult.gte.expected,
      minAge,
      "Age is not greater than or equal to the expected age"
    );
  }

  if (ageResult.lt?.result && maxAge !== ageResult.lt.expected) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "lt",
      ageResult.lt.expected,
      maxAge,
      "Age is not less than the expected age"
    );
  }

  if (
    ageResult.range?.result &&
    (minAge !== ageResult.range.expected[0] ||
      maxAge !== ageResult.range.expected[1])
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "range",
      ageResult.range.expected,
      [minAge, maxAge],
      "Age is not in the expected range"
    );
  }

  if (
    !(ageResult.lt || ageResult.lte || ageResult.eq || ageResult.range) &&
    maxAge !== 0
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "disclose",
      0,
      maxAge,
      "Maximum age should be equal to 0"
    );
  }

  if (
    !(ageResult.gte || ageResult.gt || ageResult.eq || ageResult.range) &&
    minAge !== 0
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "disclose",
      0,
      minAge,
      "Minimum age should be equal to 0"
    );
  }

  if (
    ageResult.disclose &&
    (ageResult.disclose.result !== minAge ||
      ageResult.disclose.result !== maxAge)
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "disclose",
      [minAge, maxAge],
      ageResult.disclose.result,
      "Age does not match the disclosed age in query result"
    );
  }

  return { errors, isCorrect };
}

function validateBirthdateQueryResult(
  ci: Record<string, Record<string, unknown>> | undefined,
  queryResult: QueryResult
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  const birthdateResult = queryResult.birthdate;
  if (!birthdateResult) {
    addStructuredError(
      errors,
      "birthdate",
      "disclose",
      "present",
      "missing",
      "Birthdate is not set in the query result"
    );
    return { errors, isCorrect: false };
  }

  let isCorrect = true;
  const birthdateInputs =
    (ci?.compare_birthdate as
      | { minDateTimestamp: number; maxDateTimestamp: number }
      | undefined) ??
    (ci?.compare_birthdate_evm as
      | { minDateTimestamp: number; maxDateTimestamp: number }
      | undefined);

  if (!birthdateInputs) {
    addStructuredError(
      errors,
      "birthdate",
      "proof",
      "compare_birthdate",
      "missing",
      "Birthdate result was provided without committed birthdate inputs"
    );
    return { errors, isCorrect: false };
  }

  const minDate = getBirthdateMinDateTimestamp(
    birthdateInputs,
    -1 * SECONDS_BETWEEN_1900_AND_1970
  );
  const maxDate = getBirthdateMaxDateTimestamp(
    birthdateInputs,
    -1 * SECONDS_BETWEEN_1900_AND_1970
  );

  if (
    birthdateResult.gte?.result &&
    !areDatesEqual(minDate, birthdateResult.gte.expected)
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "gte",
      birthdateResult.gte.expected,
      minDate,
      "Birthdate is not greater than or equal to the expected birthdate"
    );
  }

  if (
    birthdateResult.lte?.result &&
    !areDatesEqual(maxDate, birthdateResult.lte.expected)
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "lte",
      birthdateResult.lte.expected,
      maxDate,
      "Birthdate is not less than the expected birthdate"
    );
  }

  if (
    birthdateResult.range?.result &&
    !(
      areDatesEqual(minDate, birthdateResult.range.expected[0]) &&
      areDatesEqual(maxDate, birthdateResult.range.expected[1])
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "range",
      birthdateResult.range.expected,
      [minDate, maxDate],
      "Birthdate is not in the expected range"
    );
  }

  if (
    !(
      birthdateResult.lte ||
      birthdateResult.lt ||
      birthdateResult.eq ||
      birthdateResult.range ||
      areDatesEqual(maxDate, DEFAULT_ZERO_DATE)
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "disclose",
      DEFAULT_ZERO_DATE,
      maxDate,
      "Maximum birthdate should be equal to default date value"
    );
  }

  if (
    !(
      birthdateResult.gte ||
      birthdateResult.gt ||
      birthdateResult.eq ||
      birthdateResult.range ||
      areDatesEqual(minDate, DEFAULT_ZERO_DATE)
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "disclose",
      DEFAULT_ZERO_DATE,
      minDate,
      "Minimum birthdate should be equal to default date value"
    );
  }

  return { errors, isCorrect };
}

function validateExpiryDateQueryResult(
  ci: Record<string, Record<string, unknown>> | undefined,
  queryResult: QueryResult
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  const expiryResult = queryResult.expiry_date;
  if (!expiryResult) {
    addStructuredError(
      errors,
      "expiry_date",
      "disclose",
      "present",
      "missing",
      "Expiry date is not set in the query result"
    );
    return { errors, isCorrect: false };
  }

  let isCorrect = true;
  const expiryInputs =
    (ci?.compare_expiry as
      | { minDateTimestamp: number; maxDateTimestamp: number }
      | undefined) ??
    (ci?.compare_expiry_evm as
      | { minDateTimestamp: number; maxDateTimestamp: number }
      | undefined);

  if (!expiryInputs) {
    addStructuredError(
      errors,
      "expiry_date",
      "proof",
      "compare_expiry",
      "missing",
      "Expiry date result was provided without committed expiry inputs"
    );
    return { errors, isCorrect: false };
  }

  const minDate = getMinDateFromCommittedInputs(expiryInputs);
  const maxDate = getMaxDateFromCommittedInputs(expiryInputs);

  if (
    expiryResult.gte?.result &&
    !areDatesEqual(minDate, expiryResult.gte.expected)
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "gte",
      expiryResult.gte.expected,
      minDate,
      "Expiry date is not greater than or equal to the expected expiry date"
    );
  }

  if (
    expiryResult.lte?.result &&
    !areDatesEqual(maxDate, expiryResult.lte.expected)
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "lte",
      expiryResult.lte.expected,
      maxDate,
      "Expiry date is not less than the expected expiry date"
    );
  }

  if (
    expiryResult.range?.result &&
    !(
      areDatesEqual(minDate, expiryResult.range.expected[0]) &&
      areDatesEqual(maxDate, expiryResult.range.expected[1])
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "range",
      expiryResult.range.expected,
      [minDate, maxDate],
      "Expiry date is not in the expected range"
    );
  }

  if (
    !(
      expiryResult.lte ||
      expiryResult.lt ||
      expiryResult.eq ||
      expiryResult.range ||
      areDatesEqual(maxDate, DEFAULT_ZERO_DATE)
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "disclose",
      DEFAULT_ZERO_DATE,
      maxDate,
      "Maximum expiry date should be equal to default date value"
    );
  }

  if (
    !(
      expiryResult.gte ||
      expiryResult.gt ||
      expiryResult.eq ||
      expiryResult.range ||
      areDatesEqual(minDate, DEFAULT_ZERO_DATE)
    )
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "disclose",
      DEFAULT_ZERO_DATE,
      minDate,
      "Minimum expiry date should be equal to default date value"
    );
  }

  return { errors, isCorrect };
}

function validateCountrySetQueryResult(
  queryResult: QueryResult,
  fieldName: "nationality" | "issuing_country",
  kind: "in" | "out",
  countries: string[]
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  const field = queryResult[fieldName];
  if (!hasRecord(field)) {
    addStructuredError(
      errors,
      fieldName,
      kind,
      "present",
      "missing",
      `${fieldName} ${kind}clusion is not set in the query result`
    );
    return { errors, isCorrect: false };
  }

  const constraint = hasRecord(field[kind]) ? field[kind] : undefined;
  const expected =
    constraint && Array.isArray(constraint.expected)
      ? (constraint.expected as string[])
      : undefined;

  if (!expected?.every((country) => countries.includes(country))) {
    addStructuredError(
      errors,
      fieldName,
      kind,
      expected ?? [],
      countries,
      `${fieldName} ${kind}clusion list does not match the one from the query results`
    );
    return { errors, isCorrect: false };
  }

  if (kind === "out") {
    for (let index = 1; index < countries.length; index += 1) {
      const currentCountry = countries[index];
      const previousCountry = countries[index - 1];
      if (
        currentCountry !== undefined &&
        previousCountry !== undefined &&
        currentCountry < previousCountry
      ) {
        addStructuredError(
          errors,
          fieldName,
          kind,
          "sorted",
          countries,
          `The ${fieldName} exclusion list has not been sorted, and thus the proof cannot be trusted`
        );
        return { errors, isCorrect: false };
      }
    }
  }

  return { errors, isCorrect: true };
}

function validateBindQueryResult(
  queryResult: QueryResult,
  data: { user_address?: string; chain?: string; custom_data?: string }
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  let isCorrect = true;
  const bindResult = queryResult.bind;

  if (!bindResult) {
    return { errors, isCorrect };
  }

  const expectedAddress = data.user_address?.toLowerCase().replace("0x", "");
  const receivedAddress = bindResult.user_address
    ?.toLowerCase()
    .replace("0x", "");
  if (expectedAddress !== receivedAddress) {
    isCorrect = false;
    addStructuredError(
      errors,
      "bind",
      "user_address",
      data.user_address,
      bindResult.user_address,
      "Bound user address does not match the one from the query results"
    );
  }

  if (data.chain !== bindResult.chain) {
    isCorrect = false;
    addStructuredError(
      errors,
      "bind",
      "chain",
      data.chain,
      bindResult.chain,
      "Bound chain id does not match the one from the query results"
    );
  }

  const expectedCustomData = data.custom_data?.trim().toLowerCase();
  const receivedCustomData = bindResult.custom_data?.trim().toLowerCase();
  if (expectedCustomData !== receivedCustomData) {
    isCorrect = false;
    addStructuredError(
      errors,
      "bind",
      "custom_data",
      data.custom_data,
      bindResult.custom_data,
      "Bound custom data does not match the one from the query results"
    );
  }

  return { errors, isCorrect };
}

// biome-ignore lint/suspicious/useAwait: kept async for Promise<> return signature consumed by callers; the inner await was removed after oxlint await-thenable fix.
async function validateSanctionsQueryResult(
  queryResult: QueryResult,
  sanctionsBuilder: SanctionsBuilder,
  inputs: { rootHash: string; isStrict: boolean }
): Promise<QueryResultValidation> {
  const errors: Record<string, unknown> = {};
  let isCorrect = true;

  if (!queryResult.sanctions?.passed) {
    return { errors, isCorrect };
  }

  const rootHash = sanctionsBuilder.getRoot();
  if (inputs.rootHash !== rootHash) {
    isCorrect = false;
    addStructuredError(
      errors,
      "sanctions",
      "root",
      rootHash,
      inputs.rootHash,
      "Invalid sanctions registry root"
    );
  }

  if (queryResult.sanctions.isStrict !== inputs.isStrict) {
    isCorrect = false;
    addStructuredError(
      errors,
      "sanctions",
      "isStrict",
      queryResult.sanctions.isStrict,
      inputs.isStrict,
      "Invalid sanctions strict mode"
    );
  }

  return { errors, isCorrect };
}

function validateFacematchQueryResult(
  queryResult: QueryResult,
  inputs: {
    rootKeyLeaf: string;
    environment: string;
    appIdHash: string;
  }
): QueryResultValidation {
  const errors: Record<string, unknown> = {};
  let isCorrect = true;

  if (!queryResult.facematch?.passed) {
    return { errors, isCorrect };
  }

  if (!FACEMATCH_ALLOWED_ROOT_KEYS.has(inputs.rootKeyLeaf)) {
    isCorrect = false;
    addStructuredError(
      errors,
      "facematch",
      "rootKeyLeaf",
      Array.from(FACEMATCH_ALLOWED_ROOT_KEYS),
      inputs.rootKeyLeaf,
      "Invalid facematch root key hash"
    );
  }

  if (inputs.environment !== "production") {
    isCorrect = false;
    addStructuredError(
      errors,
      "facematch",
      "environment",
      "production",
      inputs.environment,
      "Invalid facematch environment, it should be production"
    );
  }

  if (!FACEMATCH_ALLOWED_APP_IDS.has(inputs.appIdHash)) {
    isCorrect = false;
    addStructuredError(
      errors,
      "facematch",
      "appIdHash",
      Array.from(FACEMATCH_ALLOWED_APP_IDS),
      inputs.appIdHash,
      "Invalid facematch app id hash, the attestation should be coming from the ZKPassport app"
    );
  }

  return { errors, isCorrect };
}

async function validateQueryResultForProof(
  name: string,
  ci: Record<string, Record<string, unknown>> | undefined,
  queryResult: QueryResult
): Promise<QueryResultValidation> {
  if (name.startsWith("disclose_bytes")) {
    return validateDiscloseBytesQueryResult(ci, queryResult);
  }

  if (name.startsWith("compare_age")) {
    return validateAgeQueryResult(ci, queryResult);
  }

  if (name.startsWith("compare_birthdate")) {
    return validateBirthdateQueryResult(ci, queryResult);
  }

  if (name.startsWith("compare_expiry")) {
    return validateExpiryDateQueryResult(ci, queryResult);
  }

  if (name.startsWith("inclusion_check_nationality")) {
    const inputs = ci?.inclusion_check_nationality as
      | { countries: string[] }
      | undefined;
    return validateCountrySetQueryResult(
      queryResult,
      "nationality",
      "in",
      inputs?.countries ?? []
    );
  }

  if (name.startsWith("exclusion_check_nationality")) {
    const inputs = ci?.exclusion_check_nationality as
      | { countries: string[] }
      | undefined;
    return validateCountrySetQueryResult(
      queryResult,
      "nationality",
      "out",
      inputs?.countries ?? []
    );
  }

  if (name.startsWith("inclusion_check_issuing_country")) {
    const inputs = ci?.inclusion_check_issuing_country as
      | { countries: string[] }
      | undefined;
    return validateCountrySetQueryResult(
      queryResult,
      "issuing_country",
      "in",
      inputs?.countries ?? []
    );
  }

  if (name.startsWith("exclusion_check_issuing_country")) {
    const inputs = ci?.exclusion_check_issuing_country as
      | { countries: string[] }
      | undefined;
    return validateCountrySetQueryResult(
      queryResult,
      "issuing_country",
      "out",
      inputs?.countries ?? []
    );
  }

  if (name.startsWith("bind")) {
    const inputs =
      (ci?.bind as
        | {
            data: {
              user_address?: string;
              chain?: string;
              custom_data?: string;
            };
          }
        | undefined) ??
      (ci?.bind_evm as
        | {
            data: {
              user_address?: string;
              chain?: string;
              custom_data?: string;
            };
          }
        | undefined);

    return validateBindQueryResult(queryResult, inputs?.data ?? {});
  }

  if (name.startsWith("exclusion_check_sanctions")) {
    const inputs =
      (ci?.exclusion_check_sanctions as
        | { rootHash: string; isStrict: boolean }
        | undefined) ??
      (ci?.exclusion_check_sanctions_evm as
        | { rootHash: string; isStrict: boolean }
        | undefined);
    const sanctionsBuilder = await SanctionsBuilder.create();
    return validateSanctionsQueryResult(queryResult, sanctionsBuilder, {
      isStrict: inputs?.isStrict ?? false,
      rootHash: inputs?.rootHash ?? "",
    });
  }

  if (name.startsWith("facematch")) {
    const inputs =
      (ci?.facematch as
        | { rootKeyLeaf: string; environment: string; appIdHash: string }
        | undefined) ??
      (ci?.facematch_evm as
        | { rootKeyLeaf: string; environment: string; appIdHash: string }
        | undefined);

    return validateFacematchQueryResult(queryResult, {
      appIdHash: inputs?.appIdHash ?? "",
      environment: inputs?.environment ?? "",
      rootKeyLeaf: inputs?.rootKeyLeaf ?? "",
    });
  }

  return { errors: {}, isCorrect: true };
}

function validateQueryResultCoverage(
  queryResult: QueryResult,
  coverage: ProofCoverage,
  errors: Record<string, unknown>
): boolean {
  let isCorrect = true;

  const disclosureFields = [
    "document_type",
    "birthdate",
    "expiry_date",
    "nationality",
    "document_number",
    "gender",
    "issuing_country",
    "fullname",
    "firstname",
    "lastname",
  ] as const;

  for (const fieldName of disclosureFields) {
    const field = queryResult[fieldName];
    if (!(hasRecord(field) && hasAnyKey(field, ["eq", "disclose"]))) {
      continue;
    }

    if (!coverage.discloseBytes) {
      isCorrect = false;
      addStructuredError(
        errors,
        fieldName,
        "proof",
        "disclose_bytes",
        "missing",
        `${fieldName} was provided without a matching disclosure proof`
      );
    }
  }

  if (queryResult.age && !coverage.age) {
    isCorrect = false;
    addStructuredError(
      errors,
      "age",
      "proof",
      "compare_age",
      "missing",
      "Age was provided without a matching age proof"
    );
  }

  if (
    hasRecord(queryResult.birthdate) &&
    hasAnyKey(queryResult.birthdate, ["gt", "gte", "lt", "lte", "range"]) &&
    !coverage.compareBirthdate
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "birthdate",
      "proof",
      "compare_birthdate",
      "missing",
      "Birthdate comparison was provided without a matching birthdate proof"
    );
  }

  if (
    hasRecord(queryResult.expiry_date) &&
    hasAnyKey(queryResult.expiry_date, ["gt", "gte", "lt", "lte", "range"]) &&
    !coverage.compareExpiry
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "expiry_date",
      "proof",
      "compare_expiry",
      "missing",
      "Expiry comparison was provided without a matching expiry proof"
    );
  }

  if (
    hasRecord(queryResult.nationality) &&
    "in" in queryResult.nationality &&
    !coverage.nationalityInclusion
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "nationality",
      "proof",
      "inclusion_check_nationality",
      "missing",
      "Nationality inclusion was provided without a matching inclusion proof"
    );
  }

  if (
    hasRecord(queryResult.nationality) &&
    "out" in queryResult.nationality &&
    !coverage.nationalityExclusion
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "nationality",
      "proof",
      "exclusion_check_nationality",
      "missing",
      "Nationality exclusion was provided without a matching exclusion proof"
    );
  }

  if (
    hasRecord(queryResult.issuing_country) &&
    "in" in queryResult.issuing_country &&
    !coverage.issuingCountryInclusion
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "issuing_country",
      "proof",
      "inclusion_check_issuing_country",
      "missing",
      "Issuing country inclusion was provided without a matching inclusion proof"
    );
  }

  if (
    hasRecord(queryResult.issuing_country) &&
    "out" in queryResult.issuing_country &&
    !coverage.issuingCountryExclusion
  ) {
    isCorrect = false;
    addStructuredError(
      errors,
      "issuing_country",
      "proof",
      "exclusion_check_issuing_country",
      "missing",
      "Issuing country exclusion was provided without a matching exclusion proof"
    );
  }

  if (queryResult.bind && !coverage.bind) {
    isCorrect = false;
    addStructuredError(
      errors,
      "bind",
      "proof",
      "bind",
      "missing",
      "Bind data was provided without a matching bind proof"
    );
  }

  if (queryResult.sanctions && !coverage.sanctions) {
    isCorrect = false;
    addStructuredError(
      errors,
      "sanctions",
      "proof",
      "exclusion_check_sanctions",
      "missing",
      "Sanctions result was provided without a matching sanctions proof"
    );
  }

  if (queryResult.facematch && !coverage.facematch) {
    isCorrect = false;
    addStructuredError(
      errors,
      "facematch",
      "proof",
      "facematch",
      "missing",
      "Facematch result was provided without a matching facematch proof"
    );
  }

  return isCorrect;
}

async function checkPublicInputs(
  domain: string,
  proofs: ProofResult[],
  queryResult: QueryResult,
  validity?: number,
  scope?: string
): Promise<PublicInputResult> {
  const sorted = sortProofs(proofs);
  const today = todayMidnight();
  const errors: Record<string, unknown> = {};
  let isCorrect = true;
  let prevCommitment: bigint | undefined;
  let nullifier: string | undefined;
  let nullifierType: NullifierType | undefined;
  const coverage: ProofCoverage = {
    age: false,
    bind: false,
    compareBirthdate: false,
    compareExpiry: false,
    discloseBytes: false,
    facematch: false,
    issuingCountryExclusion: false,
    issuingCountryInclusion: false,
    nationalityExclusion: false,
    nationalityInclusion: false,
    sanctions: false,
  };

  for (const proof of sorted) {
    const name = proof.name ?? "";
    const proofHex = proof.proof ?? "";
    const proofData = getProofData(proofHex, getNumberOfPublicInputs(name));
    const ci = proof.committedInputs as
      | Record<string, Record<string, unknown>>
      | undefined;

    // ── outer proof ──────────────────────────────────────────────
    if (name.startsWith("outer")) {
      // Certificate registry root
      const certRoot = getCertificateRegistryRootFromOuterProof(proofData);
      const certValid = await validateRootOnChain(
        "certificate",
        certRoot.toString(16)
      );
      if (!certValid) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "certificate_root",
          "valid",
          "invalid",
          "Certificate registry root is not valid on-chain"
        );
      }

      // Circuit registry root
      const circuitRoot = getCircuitRegistryRootFromOuterProof(proofData);
      const circuitValid = await validateRootOnChain(
        "circuit",
        circuitRoot.toString(16)
      );
      if (!circuitValid) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "circuit_root",
          "valid",
          "invalid",
          "Circuit registry root is not valid on-chain"
        );
      }

      // Date / validity
      const proofDate = getCurrentDateFromOuterProof(proofData);
      const diffMs = today.getTime() - proofDate.getTime();
      const validityMs = (validity ?? DEFAULT_VALIDITY_SECONDS) * 1000;
      if (diffMs >= validityMs) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "date",
          `Validity: ${validity ?? DEFAULT_VALIDITY_SECONDS}s`,
          `Difference: ${Math.round(diffMs / 1000)}s`,
          "Proof date is older than the validity period"
        );
      }

      // Parameter commitment count
      const paramCommitments = getParamCommitmentsFromOuterProof(proofData);
      const committedKeys = Object.keys(ci ?? {});
      if (committedKeys.length !== paramCommitments.length) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "commitment",
          `Parameter commitments: ${paramCommitments.length}`,
          `Disclosure proofs: ${committedKeys.length}`,
          "Proof does not verify all requested conditions"
        );
      }

      // Domain binding
      if (
        domain &&
        getServiceScopeHash(domain) !== getScopeFromOuterProof(proofData)
      ) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "scope",
          `Domain: ${domain}`,
          "Proof scope mismatch",
          "Proof comes from a different domain"
        );
      }

      // Sub-scope binding
      if (
        scope &&
        getScopeHash(scope) !== getSubscopeFromOuterProof(proofData)
      ) {
        isCorrect = false;
        addError(
          errors,
          "outer",
          "subscope",
          `Scope: ${scope}`,
          "Proof subscope mismatch",
          "Proof uses a different scope"
        );
      }

      // Per-type parameter commitment checks in the outer proof
      await verifyOuterParameterCommitments(
        ci,
        paramCommitments,
        errors,
        isCorrect
      ).then((ok) => {
        isCorrect = isCorrect && ok;
      });

      // Extract nullifier from outer proof
      nullifier = getNullifierFromOuterProof(proofData).toString(10);
      nullifierType = getNullifierTypeFromOuterProof(proofData);

      // ── sig_check_dsc ────────────────────────────────────────────
    } else if (name.startsWith("sig_check_dsc")) {
      prevCommitment = getCommitmentFromDSCProof(proofData);
      const merkleRoot = getMerkleRootFromDSCProof(proofData);
      const rootValid = await validateRootOnChain(
        "certificate",
        merkleRoot.toString(16)
      );
      if (!rootValid) {
        isCorrect = false;
        addError(
          errors,
          "sig_check_dsc",
          "certificate_root",
          "valid",
          "invalid",
          "DSC Merkle root is not valid on-chain"
        );
      }

      // ── sig_check_id_data ────────────────────────────────────────
    } else if (name.startsWith("sig_check_id_data")) {
      const commitIn = getCommitmentInFromIDDataProof(proofData);
      if (commitIn !== prevCommitment) {
        isCorrect = false;
        addError(
          errors,
          "sig_check_id_data",
          "commitment",
          prevCommitment?.toString() ?? "undefined",
          commitIn.toString(),
          "Failed to link certificate and ID signature"
        );
      }
      prevCommitment = getCommitmentOutFromIDDataProof(proofData);

      // ── data_check_integrity ─────────────────────────────────────
    } else if (name.startsWith("data_check_integrity")) {
      const commitIn = getCommitmentInFromIntegrityProof(proofData);
      if (commitIn !== prevCommitment) {
        isCorrect = false;
        addError(
          errors,
          "data_check_integrity",
          "commitment",
          prevCommitment?.toString() ?? "undefined",
          commitIn.toString(),
          "Failed to link ID signature and signed data"
        );
      }
      prevCommitment = getCommitmentOutFromIntegrityProof(proofData);

      // ── disclosure proofs ────────────────────────────────────────
    } else {
      if (name.startsWith("disclose_bytes")) {
        coverage.discloseBytes = true;
      } else if (name.startsWith("compare_age")) {
        coverage.age = true;
      } else if (name.startsWith("compare_birthdate")) {
        coverage.compareBirthdate = true;
      } else if (name.startsWith("compare_expiry")) {
        coverage.compareExpiry = true;
      } else if (name.startsWith("inclusion_check_nationality")) {
        coverage.nationalityInclusion = true;
      } else if (name.startsWith("exclusion_check_nationality")) {
        coverage.nationalityExclusion = true;
      } else if (name.startsWith("inclusion_check_issuing_country")) {
        coverage.issuingCountryInclusion = true;
      } else if (name.startsWith("exclusion_check_issuing_country")) {
        coverage.issuingCountryExclusion = true;
      } else if (name.startsWith("bind")) {
        coverage.bind = true;
      } else if (name.startsWith("exclusion_check_sanctions")) {
        coverage.sanctions = true;
      } else if (name.startsWith("facematch")) {
        coverage.facematch = true;
      }

      const queryValidation = await validateQueryResultForProof(
        name,
        ci,
        queryResult
      );
      isCorrect = isCorrect && queryValidation.isCorrect;
      mergeValidationErrors(errors, queryValidation.errors);

      const result = await verifyDisclosureProof(
        name,
        proofData,
        ci,
        prevCommitment,
        domain,
        scope,
        validity ?? DEFAULT_VALIDITY_SECONDS,
        errors
      );
      isCorrect = isCorrect && result.isCorrect;
      if (result.nullifier) {
        nullifier = result.nullifier;
        nullifierType = result.nullifierType;
      }
    }
  }

  isCorrect =
    validateQueryResultCoverage(queryResult, coverage, errors) && isCorrect;

  return { isCorrect, nullifier, nullifierType, errors };
}

// ---------------------------------------------------------------------------
// Outer proof parameter commitment validation
// ---------------------------------------------------------------------------

async function verifyOuterParameterCommitments(
  ci: Record<string, Record<string, unknown>> | undefined,
  paramCommitments: bigint[],
  errors: Record<string, unknown>,
  currentCorrect: boolean
): Promise<boolean> {
  if (!ci) {
    return currentCorrect;
  }
  let isCorrect = true;

  if (ci.compare_age) {
    const { minAge, maxAge } = ci.compare_age as {
      minAge: number;
      maxAge: number;
    };
    const expected = await getAgeParameterCommitment(minAge, maxAge);
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "age",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Age parameter commitment mismatch"
      );
    }
  }

  if (ci.compare_birthdate) {
    const { minDateTimestamp, maxDateTimestamp } = ci.compare_birthdate as {
      minDateTimestamp: number;
      maxDateTimestamp: number;
    };
    const expected = await getDateParameterCommitment(
      ProofType.BIRTHDATE,
      minDateTimestamp,
      maxDateTimestamp
    );
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "birthdate",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Birthdate parameter commitment mismatch"
      );
    }
  }

  if (ci.compare_expiry) {
    const { minDateTimestamp, maxDateTimestamp } = ci.compare_expiry as {
      minDateTimestamp: number;
      maxDateTimestamp: number;
    };
    const expected = await getDateParameterCommitment(
      ProofType.EXPIRY_DATE,
      minDateTimestamp,
      maxDateTimestamp
    );
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "expiry_date",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Expiry date parameter commitment mismatch"
      );
    }
  }

  if (ci.disclose_bytes) {
    const { discloseMask, disclosedBytes } = ci.disclose_bytes as {
      discloseMask: number[];
      disclosedBytes: number[];
    };
    const expected = await getDiscloseParameterCommitment(
      discloseMask,
      disclosedBytes
    );
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "disclose",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Disclosure parameter commitment mismatch"
      );
    }
  }

  for (const [key, proofType] of [
    ["inclusion_check_nationality", ProofType.NATIONALITY_INCLUSION],
    ["exclusion_check_nationality", ProofType.NATIONALITY_EXCLUSION],
    ["inclusion_check_issuing_country", ProofType.ISSUING_COUNTRY_INCLUSION],
    ["exclusion_check_issuing_country", ProofType.ISSUING_COUNTRY_EXCLUSION],
  ] as const) {
    if (ci[key]) {
      const { countries } = ci[key] as { countries: string[] };
      const expected = await getCountryParameterCommitment(
        proofType,
        countries as never[]
      );
      if (!paramCommitments.includes(expected)) {
        isCorrect = false;
        const label = key.includes("nationality")
          ? "nationality"
          : "issuing_country";
        addError(
          errors,
          label,
          "commitment",
          expected.toString(),
          paramCommitments.join(", "),
          `${label} parameter commitment mismatch`
        );
      }
    }
  }

  if (ci.bind) {
    const { data } = ci.bind as { data: unknown };
    const expected = await getBindParameterCommitment(
      formatBoundData(data as never)
    );
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "bind",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Bind parameter commitment mismatch"
      );
    }
  }

  if (ci.exclusion_check_sanctions) {
    const sanctionsBuilder = await SanctionsBuilder.create();
    const { isStrict } = ci.exclusion_check_sanctions as { isStrict: boolean };
    const expected =
      await sanctionsBuilder.getSanctionsParameterCommitment(isStrict);
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "sanctions",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Sanctions parameter commitment mismatch"
      );
    }
  }

  if (ci.facematch) {
    const { rootKeyLeaf, environment, appIdHash, mode } = ci.facematch as {
      rootKeyLeaf: string;
      environment: string;
      appIdHash: string;
      mode: string;
    };
    const expected = await getFacematchParameterCommitment(
      BigInt(rootKeyLeaf),
      environment === "development" ? BigInt(0) : BigInt(1),
      BigInt(appIdHash),
      mode === "regular" ? BigInt(1) : BigInt(2)
    );
    if (!paramCommitments.includes(expected)) {
      isCorrect = false;
      addError(
        errors,
        "facematch",
        "commitment",
        expected.toString(),
        paramCommitments.join(", "),
        "Facematch parameter commitment mismatch"
      );
    }
  }

  return isCorrect;
}

// ---------------------------------------------------------------------------
// Disclosure proof validation
// ---------------------------------------------------------------------------

interface DisclosureResult {
  isCorrect: boolean;
  nullifier: string | undefined;
  nullifierType: NullifierType | undefined;
}

async function verifyDisclosureProof(
  name: string,
  proofData: { publicInputs: string[]; proof: string[] },
  ci: Record<string, Record<string, unknown>> | undefined,
  prevCommitment: bigint | undefined,
  domain: string,
  scope: string | undefined,
  validitySec: number,
  errors: Record<string, unknown>
): Promise<DisclosureResult> {
  let isCorrect = true;
  const nullifier: string | undefined =
    getNullifierFromDisclosureProof(proofData).toString(10);
  const nullifierType: NullifierType | undefined =
    getNullifierTypeFromDisclosureProof(proofData);

  // Commitment chain check
  const commitIn = getCommitmentInFromDisclosureProof(proofData);
  if (commitIn !== prevCommitment) {
    isCorrect = false;
    addError(
      errors,
      name,
      "commitment",
      prevCommitment?.toString() ?? "undefined",
      commitIn.toString(),
      `Failed to link integrity data to ${name}`
    );
  }

  // Parameter commitment check (disclosure-level)
  const disclosureCommitment =
    getParameterCommitmentFromDisclosureProof(proofData);
  const expectedCommitment = await computeExpectedDisclosureCommitment(
    name,
    ci
  );
  if (
    expectedCommitment !== undefined &&
    disclosureCommitment !== expectedCommitment
  ) {
    isCorrect = false;
    addError(
      errors,
      name,
      "parameter_commitment",
      expectedCommitment.toString(),
      disclosureCommitment.toString(),
      `Parameter commitment mismatch for ${name}`
    );
  }

  // Scope check on disclosure proofs
  if (domain) {
    const disclosureScope = getServiceScopeFromDisclosureProof(proofData);
    if (getServiceScopeHash(domain) !== disclosureScope) {
      isCorrect = false;
      addError(
        errors,
        name,
        "scope",
        domain,
        disclosureScope.toString(),
        `Disclosure proof scope mismatch for ${name}`
      );
    }
  }
  if (scope) {
    const disclosureSubscope = getServiceSubScopeFromDisclosureProof(proofData);
    if (getServiceSubscopeHash(scope) !== disclosureSubscope) {
      isCorrect = false;
      addError(
        errors,
        name,
        "subscope",
        scope,
        disclosureSubscope.toString(),
        `Disclosure proof subscope mismatch for ${name}`
      );
    }
  }

  // Date check on disclosure proofs
  const disclosureDate = getCurrentDateFromDisclosureProof(proofData);
  const today = todayMidnight();
  const diffMs = today.getTime() - disclosureDate.getTime();
  const validityMs = validitySec * 1000;
  if (diffMs >= validityMs) {
    isCorrect = false;
    addError(
      errors,
      name,
      "date",
      `Validity: ${validitySec}s`,
      `Difference: ${Math.round(diffMs / 1000)}s`,
      `Disclosure proof date too old for ${name}`
    );
  }

  return { isCorrect, nullifier, nullifierType };
}

async function computeExpectedDisclosureCommitment(
  name: string,
  ci: Record<string, Record<string, unknown>> | undefined
): Promise<bigint | undefined> {
  if (!ci) {
    return undefined;
  }

  if (name === "disclose_bytes" && ci.disclose_bytes) {
    const { discloseMask, disclosedBytes } = ci.disclose_bytes as {
      discloseMask: number[];
      disclosedBytes: number[];
    };
    return getDiscloseParameterCommitment(discloseMask, disclosedBytes);
  }

  if (name === "compare_age" && ci.compare_age) {
    const { minAge, maxAge } = ci.compare_age as {
      minAge: number;
      maxAge: number;
    };
    return getAgeParameterCommitment(minAge, maxAge);
  }

  if (name === "compare_birthdate" && ci.compare_birthdate) {
    const { minDateTimestamp, maxDateTimestamp } = ci.compare_birthdate as {
      minDateTimestamp: number;
      maxDateTimestamp: number;
    };
    return getDateParameterCommitment(
      ProofType.BIRTHDATE,
      minDateTimestamp,
      maxDateTimestamp
    );
  }

  if (name === "compare_expiry" && ci.compare_expiry) {
    const { minDateTimestamp, maxDateTimestamp } = ci.compare_expiry as {
      minDateTimestamp: number;
      maxDateTimestamp: number;
    };
    return getDateParameterCommitment(
      ProofType.EXPIRY_DATE,
      minDateTimestamp,
      maxDateTimestamp
    );
  }

  for (const [key, proofType] of [
    ["inclusion_check_nationality", ProofType.NATIONALITY_INCLUSION],
    ["exclusion_check_nationality", ProofType.NATIONALITY_EXCLUSION],
    ["inclusion_check_issuing_country", ProofType.ISSUING_COUNTRY_INCLUSION],
    ["exclusion_check_issuing_country", ProofType.ISSUING_COUNTRY_EXCLUSION],
  ] as const) {
    if (name.startsWith(key) && ci[key]) {
      const { countries } = ci[key] as { countries: string[] };
      const shouldSort =
        proofType === ProofType.NATIONALITY_EXCLUSION ||
        proofType === ProofType.ISSUING_COUNTRY_EXCLUSION;
      return getCountryParameterCommitment(
        proofType,
        countries as never[],
        shouldSort
      );
    }
  }

  if (name === "bind" && ci.bind) {
    const { data } = ci.bind as { data: unknown };
    return getBindParameterCommitment(formatBoundData(data as never));
  }

  if (name === "exclusion_check_sanctions" && ci.exclusion_check_sanctions) {
    const sanctionsBuilder = await SanctionsBuilder.create();
    const { isStrict } = ci.exclusion_check_sanctions as { isStrict: boolean };
    return sanctionsBuilder.getSanctionsParameterCommitment(isStrict);
  }

  if (name.startsWith("facematch") && ci.facematch) {
    const { rootKeyLeaf, environment, appIdHash, mode } = ci.facematch as {
      rootKeyLeaf: string;
      environment: string;
      appIdHash: string;
      mode: string;
    };
    return getFacematchParameterCommitment(
      BigInt(rootKeyLeaf),
      environment === "development" ? BigInt(0) : BigInt(1),
      BigInt(appIdHash),
      mode === "regular" ? BigInt(1) : BigInt(2)
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Cryptographic proof verification
// ---------------------------------------------------------------------------

async function verifyProofCryptographic(
  proof: ProofResult,
  manifest: CircuitManifest,
  backend: UltraHonkVerifierBackend
): Promise<boolean> {
  const name = proof.name ?? "";
  const proofHex = proof.proof ?? "";
  try {
    const proofData = getProofData(proofHex, getNumberOfPublicInputs(name));
    const vk = await getCachedVk(name, manifest);
    const proofBytes = Buffer.from(proofData.proof.join(""), "hex");
    return await backend.verifyProof({
      proof: proofBytes,
      publicInputs: proofData.publicInputs,
      verificationKey: new Uint8Array(vk),
    });
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        proofName: name,
      },
      "ZKPassport proof verification threw for a circuit"
    );
    return false;
  }
}

async function verifyOuterEvmProofOnChain(params: {
  devMode?: boolean;
  domain: string;
  proof: ProofResult;
  scope?: string;
  validity?: number;
}): Promise<boolean> {
  try {
    const [{ ZKPassport }, { createPublicClient, http }, { sepolia }] =
      await Promise.all([
        import("@zkpassport/sdk"),
        import("viem"),
        import("viem/chains"),
      ]);

    const sdk = new ZKPassport(params.domain);
    const { address, abi, functionName } = sdk.getSolidityVerifierDetails();
    const client = createPublicClient({
      chain: sepolia,
      transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
    });
    const solidityParams: {
      proof: ProofResult;
      validityPeriodInSeconds?: number;
      domain: string;
      scope?: string;
      devMode?: boolean;
    } = {
      proof: params.proof,
      domain: params.domain,
    };
    if (params.validity !== undefined) {
      solidityParams.validityPeriodInSeconds = params.validity;
    }
    if (params.scope !== undefined) {
      solidityParams.scope = params.scope;
    }
    if (params.devMode !== undefined) {
      solidityParams.devMode = params.devMode;
    }
    const verifierParams = sdk.getSolidityVerifierParameters(solidityParams);
    const result = await client.readContract({
      address,
      abi,
      functionName,
      args: [verifierParams],
    });
    return Array.isArray(result) ? Boolean(result[0]) : false;
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        proofName: params.proof.name ?? "",
      },
      "ZKPassport outer_evm proof verification threw"
    );
    return false;
  }
}

async function verifyWithSdkFallback(
  params: VerifyParams
): Promise<Omit<VerifyResult, "verificationTimeMs">> {
  const { ZKPassport } = await import("@zkpassport/sdk");
  const sdk = new ZKPassport(params.domain);
  const verifyParams: {
    devMode?: boolean;
    proofs: ProofResult[];
    queryResult: QueryResult;
    scope?: string;
    validity?: number;
    writingDirectory?: string;
  } = {
    proofs: params.proofs,
    queryResult: params.queryResult,
    writingDirectory: env.BB_CRS_PATH,
  };

  if (params.validity !== undefined) {
    verifyParams.validity = params.validity;
  }
  if (params.scope !== undefined) {
    verifyParams.scope = params.scope;
  }
  if (params.devMode !== undefined) {
    verifyParams.devMode = params.devMode;
  }

  const result = await sdk.verify(verifyParams);

  return {
    verified: result.verified,
    uniqueIdentifier: result.uniqueIdentifier,
    uniqueIdentifierType: result.uniqueIdentifierType,
    queryResultErrors: result.queryResultErrors as
      | Record<string, unknown>
      | undefined,
  };
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

const MOCK_NULLIFIER_TYPES = new Set([
  NullifierType.NON_SALTED_MOCK,
  NullifierType.SALTED_MOCK,
]);

export async function verifyZkPassportProofs(
  params: VerifyParams
): Promise<VerifyResult> {
  const {
    domain,
    proofs,
    queryResult,
    devMode = false,
    scope,
    validity,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  const start = performance.now();

  if (!proofs || proofs.length === 0) {
    return {
      verified: false,
      uniqueIdentifier: undefined,
      uniqueIdentifierType: undefined,
      queryResultErrors: undefined,
      verificationTimeMs: 0,
    };
  }

  // Timeout guard
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formattedResult = formatQueryResultDates(queryResult);

    // Phase 1: Validate public inputs
    console.log(
      "[zkpassport-verifier] Starting verification for",
      proofs.length,
      "proofs, domain:",
      domain,
      "devMode:",
      devMode
    );
    const { isCorrect, nullifier, nullifierType, errors } =
      await checkPublicInputs(domain, proofs, formattedResult, validity, scope);
    console.log("[zkpassport-verifier] Public input check:", {
      isCorrect,
      nullifier,
      nullifierType: nullifierType as number,
      errors,
    });

    // Mock nullifier rejection (unless devMode)
    if (
      nullifierType !== undefined &&
      MOCK_NULLIFIER_TYPES.has(nullifierType) &&
      !devMode
    ) {
      logger.warn("Mock proof rejected in non-dev mode");
      return {
        verified: false,
        uniqueIdentifier: undefined,
        uniqueIdentifierType: undefined,
        queryResultErrors: Object.keys(errors).length > 0 ? errors : undefined,
        verificationTimeMs: performance.now() - start,
      };
    }

    // Phase 2: Cryptographic proof verification (only if public inputs passed)
    let verified = isCorrect;
    let cryptographicFailureProofName: string | undefined;
    let queryResultErrors = Object.keys(errors).length > 0 ? errors : undefined;
    let uniqueIdentifier = nullifier;
    let uniqueIdentifierType = nullifierType;
    if (verified) {
      const [backend, manifest] = await Promise.all([
        getVerifierBackend(),
        getCachedManifest(proofs[0]?.version ?? ""),
      ]);

      for (const proof of proofs) {
        const name = proof.name ?? "";
        if (controller.signal.aborted) {
          throw new Error("ZKPassport verification timed out");
        }

        const proofValid = name.startsWith("outer_evm")
          ? await verifyOuterEvmProofOnChain({
              proof,
              domain,
              ...(scope === undefined ? {} : { scope }),
              ...(devMode === undefined ? {} : { devMode }),
              ...(validity === undefined ? {} : { validity }),
            })
          : await verifyProofCryptographic(proof, manifest, backend);
        if (!proofValid) {
          verified = false;
          cryptographicFailureProofName = name;
          logger.warn(
            { proofName: name },
            "ZKPassport cryptographic verification failed for a proof"
          );
          break;
        }
      }
    }

    if (!verified && isCorrect) {
      try {
        logger.warn(
          {
            failedProofName: cryptographicFailureProofName,
            proofCount: proofs.length,
          },
          "Fast ZKPassport verification disagreed after public input checks; retrying with SDK verifier"
        );
        const fallbackParams: VerifyParams = {
          domain,
          proofs,
          queryResult: formattedResult,
        };
        if (devMode !== undefined) {
          fallbackParams.devMode = devMode;
        }
        if (scope !== undefined) {
          fallbackParams.scope = scope;
        }
        if (validity !== undefined) {
          fallbackParams.validity = validity;
        }
        if (timeoutMs !== undefined) {
          fallbackParams.timeoutMs = timeoutMs;
        }

        const fallback = await verifyWithSdkFallback(fallbackParams);
        verified = fallback.verified;
        uniqueIdentifier = fallback.uniqueIdentifier;
        uniqueIdentifierType = fallback.uniqueIdentifierType;
        queryResultErrors = fallback.queryResultErrors;
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            failedProofName: cryptographicFailureProofName,
          },
          "SDK fallback verification failed"
        );
      }
    }

    const elapsed = performance.now() - start;
    logger.info(
      { durationMs: Math.round(elapsed), verified, proofCount: proofs.length },
      "ZKPassport proof verification complete"
    );

    return {
      verified,
      uniqueIdentifier: verified ? uniqueIdentifier : undefined,
      uniqueIdentifierType: verified ? uniqueIdentifierType : undefined,
      queryResultErrors,
      verificationTimeMs: elapsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Warmup
// ---------------------------------------------------------------------------

export function warmupZkPassportVerifier(): Promise<void> {
  if (prewarmPromise) {
    return prewarmPromise;
  }

  prewarmPromise = (async () => {
    const start = performance.now();
    try {
      await getVerifierBackend();
      // Also pre-create the registry client
      getRegistry();
      const elapsed = performance.now() - start;
      logger.info(
        { durationMs: Math.round(elapsed) },
        "ZKPassport verifier warmed up"
      );
    } catch (error) {
      const elapsed = performance.now() - start;
      logger.error(
        { durationMs: Math.round(elapsed), error },
        "ZKPassport verifier warmup failed"
      );
      throw error;
    }
  })();

  return prewarmPromise;
}

interface VerifierTestApi {
  computeExpectedDisclosureCommitment: typeof computeExpectedDisclosureCommitment;
  reset(): void;
  validateRootOnChain: typeof validateRootOnChain;
  verifyOuterEvmProofOnChain: typeof verifyOuterEvmProofOnChain;
}

(
  verifyZkPassportProofs as typeof verifyZkPassportProofs & {
    __testOnly: VerifierTestApi;
  }
).__testOnly = {
  reset(): void {
    manifestCache.clear();
    vkCache.clear();
    rootValidityCache.clear();
    verifierBackend = null;
    backendInitPromise = null;
    registryClient = null;
    prewarmPromise = null;
  },
  computeExpectedDisclosureCommitment,
  validateRootOnChain,
  verifyOuterEvmProofOnChain,
};

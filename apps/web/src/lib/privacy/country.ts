/**
 * Country Code Module
 *
 * Provides country code conversions, groups, and Merkle tree operations
 * for nationality proofs.
 *
 * Uses zkpassport's weighted-sum encoding and i18n-iso-countries for
 * standardized country data.
 */

import {
  getCountryFromWeightedSum,
  getCountryWeightedSum,
  ASEAN_COUNTRIES as ZKPASSPORT_ASEAN,
  EEA_COUNTRIES as ZKPASSPORT_EEA,
  EU_COUNTRIES as ZKPASSPORT_EU,
  MERCOSUR_COUNTRIES as ZKPASSPORT_MERCOSUR,
  SANCTIONED_COUNTRIES as ZKPASSPORT_SANCTIONED,
  SCHENGEN_COUNTRIES as ZKPASSPORT_SCHENGEN,
} from "@zkpassport/utils";
import countries from "i18n-iso-countries";

export type HashFn = (values: bigint[]) => Promise<bigint>;

export const TREE_DEPTH = 8;

// ============================================================================
// Name → Alpha3 Conversion (using i18n-iso-countries)
// ============================================================================

function nameToAlpha3(name: string): string | undefined {
  return countries.getAlpha3Code(name, "en") || undefined;
}

function convertNamesToAlpha3(names: string[]): string[] {
  return names
    .map((name) => nameToAlpha3(name))
    .filter((code): code is string => code !== undefined);
}

// ============================================================================
// Country Groups (derived from zkpassport + custom)
// ============================================================================

type CountryGroup =
  | "EU"
  | "EEA"
  | "SCHENGEN"
  | "ASEAN"
  | "MERCOSUR"
  | "FIVE_EYES"
  | "LATAM"
  | "SANCTIONED"
  | "GLOBAL";

// Convert zkpassport's name-based groups to Alpha3
const EU_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_EU);
const EEA_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_EEA);
const SCHENGEN_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_SCHENGEN);
const ASEAN_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_ASEAN);
const MERCOSUR_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_MERCOSUR);
const SANCTIONED_COUNTRIES = convertNamesToAlpha3(ZKPASSPORT_SANCTIONED);

// Custom groups not in zkpassport
const FIVE_EYES_COUNTRIES: string[] = ["AUS", "CAN", "NZL", "GBR", "USA"];
const LATAM_COUNTRIES: string[] = [
  "ARG",
  "BOL",
  "BRA",
  "CHL",
  "COL",
  "CRI",
  "CUB",
  "DOM",
  "ECU",
  "SLV",
  "GTM",
  "HND",
  "MEX",
  "NIC",
  "PAN",
  "PRY",
  "PER",
  "PRI",
  "URY",
  "VEN",
];

// All ISO 3166-1 Alpha3 codes from i18n-iso-countries
const ALL_COUNTRIES = Object.keys(countries.getAlpha3Codes());

export const COUNTRY_GROUPS: Record<CountryGroup, string[]> = {
  EU: EU_COUNTRIES,
  EEA: EEA_COUNTRIES,
  SCHENGEN: SCHENGEN_COUNTRIES,
  ASEAN: ASEAN_COUNTRIES,
  MERCOSUR: MERCOSUR_COUNTRIES,
  LATAM: LATAM_COUNTRIES,
  FIVE_EYES: FIVE_EYES_COUNTRIES,
  SANCTIONED: SANCTIONED_COUNTRIES,
  GLOBAL: ALL_COUNTRIES,
};

// ============================================================================
// Passport-Specific Codes
// ============================================================================

const PASSPORT_CODE_TO_ALPHA3: Record<string, string> = {
  GBD: "GBR",
  GBN: "GBR",
  GBO: "GBR",
  GBP: "GBR",
  GBS: "GBR",
  RKS: "XKX",
  XKX: "XKX", // Kosovo
  UNO: "UNO",
  UNA: "UNA", // UN codes
  XXA: "XXA",
  XXB: "XXB",
  XXC: "XXC",
  XXX: "XXX", // Stateless/refugee
  ROC: "TWN", // Taiwan
};

// ============================================================================
// Conversion Functions
// ============================================================================

const ALL_COUNTRIES_SET = new Set(ALL_COUNTRIES);

function isValidAlpha3(code: string): boolean {
  return ALL_COUNTRIES_SET.has(code);
}

function toAlpha3(code: string | number): string | undefined {
  if (typeof code === "number") {
    const alpha3 = getCountryFromWeightedSum(code);
    return isValidAlpha3(alpha3) ? alpha3 : undefined;
  }

  const upperCode = code.toUpperCase().trim();

  if (isValidAlpha3(upperCode)) {
    return upperCode;
  }

  // Try Alpha2 → Alpha3
  const fromAlpha2 = countries.alpha2ToAlpha3(upperCode);
  if (fromAlpha2 && isValidAlpha3(fromAlpha2)) {
    return fromAlpha2;
  }

  // Check passport-specific codes
  const passportCode = PASSPORT_CODE_TO_ALPHA3[upperCode];
  if (passportCode) {
    return passportCode;
  }

  return undefined;
}

export function toNumericCode(code: string | number): number | undefined {
  if (typeof code === "number") {
    const alpha3 = getCountryFromWeightedSum(code);
    return isValidAlpha3(alpha3) ? code : undefined;
  }
  const alpha3 = toAlpha3(code);
  return alpha3
    ? getCountryWeightedSum(
        alpha3 as Parameters<typeof getCountryWeightedSum>[0]
      )
    : undefined;
}

export function getCountryName(code: string | number): string | undefined {
  const alpha3 = toAlpha3(code);
  if (!alpha3) {
    return undefined;
  }
  return countries.getName(alpha3, "en") || undefined;
}

// ============================================================================
// Group Functions
// ============================================================================

export function getCountriesInGroup(groupName: string): string[] | undefined {
  return COUNTRY_GROUPS[groupName.toUpperCase() as CountryGroup];
}

export function isCountryInGroup(
  countryCode: string | number,
  groupName: string
): boolean {
  const alpha3 = toAlpha3(countryCode);
  if (!alpha3) {
    return false;
  }
  const group = getCountriesInGroup(groupName);
  return group?.includes(alpha3) ?? false;
}

export function listCountryGroups(): CountryGroup[] {
  return Object.keys(COUNTRY_GROUPS) as CountryGroup[];
}

// ============================================================================
// Merkle Tree Functions
// ============================================================================

interface NationalityCircuitInputs {
  nationalityCode: number;
  merkleRoot: string;
  pathElements: string[];
  pathIndices: number[];
}

async function buildMerkleTree(
  countryCodes: number[],
  poseidon2Hash: HashFn
): Promise<{
  root: bigint;
  leaves: bigint[];
  leafIndices: Map<number, number>;
}> {
  const treeSize = 2 ** TREE_DEPTH;
  const paddedCodes = [...countryCodes];
  while (paddedCodes.length < treeSize) {
    paddedCodes.push(0);
  }

  const leaves: bigint[] = [];
  const leafIndices = new Map<number, number>();

  for (let i = 0; i < paddedCodes.length; i++) {
    const code = paddedCodes[i];
    const leafHash = await poseidon2Hash([BigInt(code)]);
    leaves.push(leafHash);
    if (code !== 0) {
      leafIndices.set(code, i);
    }
  }

  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const parent = await poseidon2Hash([
        currentLevel[i],
        currentLevel[i + 1],
      ]);
      nextLevel.push(parent);
    }
    currentLevel = nextLevel;
  }

  return { root: currentLevel[0], leaves, leafIndices };
}

async function generateMerkleProof(
  countryCodes: number[],
  targetCode: number,
  poseidon2Hash: HashFn
): Promise<{
  pathElements: bigint[];
  pathIndices: number[];
  merkleRoot: bigint;
  leafIndex: number;
}> {
  const treeSize = 2 ** TREE_DEPTH;
  const paddedCodes = [...countryCodes];
  while (paddedCodes.length < treeSize) {
    paddedCodes.push(0);
  }

  const levels: bigint[][] = [];
  const leaves: bigint[] = [];
  let leafIndex = -1;

  for (let i = 0; i < paddedCodes.length; i++) {
    const code = paddedCodes[i];
    const leafHash = await poseidon2Hash([BigInt(code)]);
    leaves.push(leafHash);
    if (code === targetCode) {
      leafIndex = i;
    }
  }
  levels.push(leaves);

  if (leafIndex === -1) {
    throw new Error(`Country code ${targetCode} not found in group`);
  }

  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const parent = await poseidon2Hash([
        currentLevel[i],
        currentLevel[i + 1],
      ]);
      nextLevel.push(parent);
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let idx = leafIndex;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push(levels[level][siblingIdx]);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }

  const root = levels.at(-1);
  if (!root) {
    throw new Error("Invalid Merkle tree: no root level");
  }

  return { pathElements, pathIndices, merkleRoot: root[0], leafIndex };
}

const merkleRootCache = new Map<string, bigint>();

export async function getMerkleRoot(
  groupName: string,
  poseidon2Hash: HashFn
): Promise<bigint> {
  const upperGroup = groupName.toUpperCase();
  const cached = merkleRootCache.get(upperGroup);
  if (cached !== undefined) {
    return cached;
  }

  const group = COUNTRY_GROUPS[upperGroup as CountryGroup];
  if (!group) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  const codes = group.map((c) =>
    getCountryWeightedSum(c as Parameters<typeof getCountryWeightedSum>[0])
  );
  const { root } = await buildMerkleTree(codes, poseidon2Hash);
  merkleRootCache.set(upperGroup, root);
  return root;
}

export async function generateNationalityProofInputs(
  nationalityCode: string,
  groupName: string,
  poseidon2Hash: HashFn
): Promise<NationalityCircuitInputs> {
  const upperCode = nationalityCode.toUpperCase();
  const upperGroup = groupName.toUpperCase();

  if (!isValidAlpha3(upperCode)) {
    throw new Error(`Unknown nationality code: ${nationalityCode}`);
  }
  const numericCode = getCountryWeightedSum(
    upperCode as Parameters<typeof getCountryWeightedSum>[0]
  );

  const group = COUNTRY_GROUPS[upperGroup as CountryGroup];
  if (!group) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  if (!group.includes(upperCode)) {
    throw new Error(`${nationalityCode} is not a member of ${groupName}`);
  }

  const codes = group.map((c) =>
    getCountryWeightedSum(c as Parameters<typeof getCountryWeightedSum>[0])
  );
  const proof = await generateMerkleProof(codes, numericCode, poseidon2Hash);

  return {
    nationalityCode: numericCode,
    merkleRoot: `0x${proof.merkleRoot.toString(16)}`,
    pathElements: proof.pathElements.map((e) => `0x${e.toString(16)}`),
    pathIndices: proof.pathIndices,
  };
}

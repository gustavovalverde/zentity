/**
 * Country Code Module
 *
 * Provides country code conversions and groups for nationality proofs.
 *
 * Uses zkpassport's weighted-sum encoding and i18n-iso-countries for
 * standardized country data.
 */

import {
  AsyncIMT,
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
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };

// i18n-iso-countries ships its browser build with no locale registered, so
// getName/getAlpha3Code return undefined client-side (Node's entry auto-registers,
// the bundler's does not). Register English once, before the country groups below
// are derived at module load.
countries.registerLocale(enLocale);

type HashFn = (values: bigint[]) => Promise<bigint>;

const TREE_DEPTH = 8;

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
    // Try ISO 3166-1 numeric first (used by on-chain attestation)
    const fromIso = countries.numericToAlpha3(code);
    if (fromIso) {
      return fromIso;
    }
    // Fall back to zkpassport weighted-sum encoding (used by ZK circuits)
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
// Nationality Merkle Tree (nationality_membership circuit inputs)
// ============================================================================

export interface NationalityMembershipInputs {
  merkleRoot: string;
  nationalityCode: number;
  pathElements: string[];
  pathIndices: number[];
}

export interface NationalityTree {
  /** Circuit inputs proving `nationalityCode` (alpha-3) is in the group. */
  prove(nationalityCode: string): NationalityMembershipInputs;
}

const toHex = (value: bigint) => `0x${value.toString(16)}`;

/**
 * Builds the group's fixed-depth Poseidon2 tree: each leaf is hash([code]),
 * unused leaves are hash([0]), parents are hash([left, right]), matching
 * nationality_membership/src/main.nr. All 2^TREE_DEPTH leaves are hashed
 * explicitly because AsyncIMT would otherwise pad with a raw 0.
 */
export async function buildNationalityTree(
  groupName: string,
  hash: HashFn
): Promise<NationalityTree> {
  const upperGroup = groupName.toUpperCase();
  const group = COUNTRY_GROUPS[upperGroup as CountryGroup];
  if (!group) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  const leaves = new Array<bigint>(2 ** TREE_DEPTH).fill(await hash([0n]));
  const indexByCode = new Map<string, number>();
  for (const [index, alpha3] of group.entries()) {
    const code = getCountryWeightedSum(
      alpha3 as Parameters<typeof getCountryWeightedSum>[0]
    );
    leaves[index] = await hash([BigInt(code)]);
    indexByCode.set(alpha3, index);
  }

  const tree = new AsyncIMT(
    (values) => hash(values.map(BigInt)),
    TREE_DEPTH,
    2
  );
  await tree.initialize(0, leaves);
  const merkleRoot = toHex(BigInt(tree.root));

  return {
    prove(nationalityCode) {
      const alpha3 = nationalityCode.toUpperCase();
      const index = indexByCode.get(alpha3);
      if (index === undefined) {
        throw new Error(`${nationalityCode} is not a member of ${groupName}`);
      }
      const proof = tree.createProof(index);
      return {
        nationalityCode: getCountryWeightedSum(
          alpha3 as Parameters<typeof getCountryWeightedSum>[0]
        ),
        merkleRoot,
        pathElements: proof.siblings.flat().map((e) => toHex(BigInt(e))),
        pathIndices: proof.pathIndices,
      };
    },
  };
}

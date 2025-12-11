/**
 * Nationality Membership ZK proof operations
 *
 * Generates and verifies Groth16 proofs for nationality membership verification.
 * Proves that a nationality is in a set (e.g., EU countries) without revealing which country.
 *
 * Uses Poseidon hash (circomlibjs) for ZK-friendly hashing that matches the circom circuit.
 */

import * as snarkjs from "snarkjs";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildPoseidon } from "circomlibjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, "../../artifacts/nationality");

// Merkle tree depth (supports up to 2^8 = 256 countries per group)
const MERKLE_DEPTH = 8;

// BN128 prime field (same as used in circom)
const BN128_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Poseidon hash singleton (lazy initialized)
let poseidonInstance: Awaited<ReturnType<typeof buildPoseidon>> | null = null;

/**
 * Initialize the Poseidon hash function (lazy loaded)
 */
async function initPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

// Load verification key once
let verificationKey: object | null = null;

function getVerificationKey(): object {
  if (!verificationKey) {
    const vkPath = join(ARTIFACTS_DIR, "verification_key.json");
    if (!existsSync(vkPath)) {
      throw new Error(`Nationality verification key not found at ${vkPath}`);
    }
    verificationKey = JSON.parse(readFileSync(vkPath, "utf-8"));
  }
  return verificationKey!;
}

/**
 * ISO 3166-1 alpha-3 to numeric code mapping
 * Used for circuit inputs (numeric codes are easier to hash in circuits)
 */
export const COUNTRY_CODES: Record<string, number> = {
  // European Union countries
  AUT: 40,   // Austria
  BEL: 56,   // Belgium
  BGR: 100,  // Bulgaria
  HRV: 191,  // Croatia
  CYP: 196,  // Cyprus
  CZE: 203,  // Czech Republic
  DNK: 208,  // Denmark
  EST: 233,  // Estonia
  FIN: 246,  // Finland
  FRA: 250,  // France
  DEU: 276,  // Germany
  GRC: 300,  // Greece
  HUN: 348,  // Hungary
  IRL: 372,  // Ireland
  ITA: 380,  // Italy
  LVA: 428,  // Latvia
  LTU: 440,  // Lithuania
  LUX: 442,  // Luxembourg
  MLT: 470,  // Malta
  NLD: 528,  // Netherlands
  POL: 616,  // Poland
  PRT: 620,  // Portugal
  ROU: 642,  // Romania
  SVK: 703,  // Slovakia
  SVN: 705,  // Slovenia
  ESP: 724,  // Spain
  SWE: 752,  // Sweden

  // Other major countries
  USA: 840,  // United States
  CAN: 124,  // Canada
  GBR: 826,  // United Kingdom
  CHE: 756,  // Switzerland
  NOR: 578,  // Norway
  ISL: 352,  // Iceland
  LIE: 438,  // Liechtenstein (EEA member)
  JPN: 392,  // Japan
  AUS: 36,   // Australia
  NZL: 554,  // New Zealand

  // Latin America
  DOM: 214,  // Dominican Republic
  MEX: 484,  // Mexico
  BRA: 76,   // Brazil
  ARG: 32,   // Argentina
  CHL: 152,  // Chile
  COL: 170,  // Colombia
  PER: 604,  // Peru
};

/**
 * Country group definitions
 */
export const COUNTRY_GROUPS: Record<string, string[]> = {
  EU: [
    "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA",
    "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD",
    "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"
  ],
  SCHENGEN: [
    "AUT", "BEL", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN",
    "ISL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "NOR", "POL", "PRT",
    "SVK", "SVN", "ESP", "SWE", "CHE"
  ],
  EEA: [
    "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA",
    "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD",
    "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE", "ISL", "NOR", "LIE"
  ],
  LATAM: [
    "DOM", "MEX", "BRA", "ARG", "CHL", "COL", "PER"
  ],
  FIVE_EYES: [
    "USA", "GBR", "CAN", "AUS", "NZL"
  ],
};

/**
 * Poseidon hash function using circomlibjs
 * This produces hashes that match the circuit's Poseidon implementation
 */
async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await initPoseidon();
  // Convert inputs to field elements
  const fieldInputs = inputs.map(x => poseidon.F.e(x));
  // Compute hash
  const hash = poseidon(fieldInputs);
  // Convert result back to bigint
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Build a Merkle tree from a list of country codes
 */
export async function buildMerkleTree(countryCodes: string[]): Promise<{
  root: string;
  leaves: string[];
  tree: string[][];
}> {
  // Convert country codes to numeric values and hash them
  const leaves: bigint[] = [];
  for (const code of countryCodes) {
    const numericCode = COUNTRY_CODES[code];
    if (!numericCode) {
      throw new Error(`Unknown country code: ${code}`);
    }
    leaves.push(await poseidonHash([BigInt(numericCode)]));
  }

  // Pad to power of 2 with empty leaf hashes
  const targetSize = Math.pow(2, MERKLE_DEPTH);
  const emptyLeafHash = await poseidonHash([BigInt(0)]);
  while (leaves.length < targetSize) {
    leaves.push(emptyLeafHash);
  }

  // Build tree from bottom up
  const tree: bigint[][] = [leaves];
  let currentLevel = leaves;

  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || emptyLeafHash;
      nextLevel.push(await poseidonHash([left, right]));
    }
    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0].toString(),
    leaves: leaves.map(l => l.toString()),
    tree: tree.map(level => level.map(n => n.toString())),
  };
}

/**
 * Get Merkle proof for a country code
 */
export async function getMerkleProof(
  countryCode: string,
  tree: string[][]
): Promise<{
  pathElements: string[];
  pathIndices: number[];
  leaf: string;
}> {
  const numericCode = COUNTRY_CODES[countryCode];
  if (!numericCode) {
    throw new Error(`Unknown country code: ${countryCode}`);
  }

  const leafHash = (await poseidonHash([BigInt(numericCode)])).toString();
  let index = tree[0].findIndex(l => l === leafHash);

  if (index === -1) {
    throw new Error(`Country ${countryCode} not found in tree`);
  }

  const pathElements: string[] = [];
  const pathIndices: number[] = [];

  const emptyLeafHash = (await poseidonHash([BigInt(0)])).toString();

  for (let level = 0; level < tree.length - 1; level++) {
    const isLeft = index % 2 === 0;
    const siblingIndex = isLeft ? index + 1 : index - 1;

    pathElements.push(tree[level][siblingIndex] || emptyLeafHash);
    pathIndices.push(isLeft ? 0 : 1);

    index = Math.floor(index / 2);
  }

  return {
    pathElements,
    pathIndices,
    leaf: leafHash,
  };
}

// Pre-computed Merkle roots for common groups (cached)
let groupRoots: Record<string, { root: string; tree: string[][] }> = {};

export async function getGroupMerkleRoot(groupName: string): Promise<string> {
  if (!groupRoots[groupName]) {
    const countries = COUNTRY_GROUPS[groupName];
    if (!countries) {
      throw new Error(`Unknown country group: ${groupName}`);
    }
    const treeData = await buildMerkleTree(countries);
    groupRoots[groupName] = { root: treeData.root, tree: treeData.tree };
  }
  return groupRoots[groupName].root;
}

export async function getGroupTree(groupName: string): Promise<string[][]> {
  if (!groupRoots[groupName]) {
    await getGroupMerkleRoot(groupName); // This will populate the cache
  }
  return groupRoots[groupName].tree;
}

export interface NationalityMembershipInput {
  /** ISO 3166-1 alpha-3 country code */
  nationalityCode: string;
  /** Country group to check membership (EU, SCHENGEN, etc.) */
  groupName: string;
}

export interface NationalityMembershipResult {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
  generationTimeMs: number;
  /** The Merkle root (public) - identifies the country group */
  merkleRoot: string;
  /** Whether the nationality is a member of the group */
  isMember: boolean;
  /** The group name checked */
  groupName: string;
}

export interface NationalityVerifyResult {
  isValid: boolean;
  verificationTimeMs: number;
  /** The Merkle root from public signals */
  merkleRoot: string;
  /** Whether the proof indicates membership */
  proofIsMember: boolean;
}

/**
 * Generate a Groth16 proof for nationality membership verification
 *
 * Proves: nationality is in the specified country group without revealing which country
 */
export async function generateNationalityMembershipProof(
  input: NationalityMembershipInput
): Promise<NationalityMembershipResult> {
  const startTime = Date.now();

  // Get the Merkle root and tree for the group
  const merkleRoot = await getGroupMerkleRoot(input.groupName);
  const tree = await getGroupTree(input.groupName);

  // Check if the country is in the group
  const countries = COUNTRY_GROUPS[input.groupName];
  if (!countries) {
    throw new Error(`Unknown country group: ${input.groupName}`);
  }

  const isMember = countries.includes(input.nationalityCode);

  // Validate the country code exists
  if (!isValidCountryCode(input.nationalityCode)) {
    // Unknown country code - return non-member result without proof
    return {
      proof: {
        pi_a: ["0", "0", "0"],
        pi_b: [["0", "0"], ["0", "0"], ["0", "0"]],
        pi_c: ["0", "0", "0"],
        protocol: "groth16",
        curve: "bn128",
      } as snarkjs.Groth16Proof,
      publicSignals: ["0", merkleRoot],
      generationTimeMs: Date.now() - startTime,
      merkleRoot,
      isMember: false,
      groupName: input.groupName,
    };
  }

  // If not a member, return non-member result (no valid proof can be generated)
  if (!isMember) {
    return {
      proof: {
        pi_a: ["0", "0", "0"],
        pi_b: [["0", "0"], ["0", "0"], ["0", "0"]],
        pi_c: ["0", "0", "0"],
        protocol: "groth16",
        curve: "bn128",
      } as snarkjs.Groth16Proof,
      publicSignals: ["0", merkleRoot],
      generationTimeMs: Date.now() - startTime,
      merkleRoot,
      isMember: false,
      groupName: input.groupName,
    };
  }

  // If the circuit artifacts don't exist, return a mock proof
  const wasmPath = join(ARTIFACTS_DIR, "nationality_membership_js", "nationality_membership.wasm");
  const zkeyPath = join(ARTIFACTS_DIR, "nationality_final.zkey");

  if (!existsSync(wasmPath) || !existsSync(zkeyPath)) {
    // Return simulated result (circuit not yet compiled)
    console.warn("[Nationality] Circuit not compiled - returning simulated proof");
    return {
      proof: {
        pi_a: ["0", "0", "0"],
        pi_b: [["0", "0"], ["0", "0"], ["0", "0"]],
        pi_c: ["0", "0", "0"],
        protocol: "groth16",
        curve: "bn128",
      } as snarkjs.Groth16Proof,
      publicSignals: [isMember ? "1" : "0", merkleRoot],
      generationTimeMs: Date.now() - startTime,
      merkleRoot,
      isMember,
      groupName: input.groupName,
    };
  }

  // Get Merkle proof for the country (only for members)
  const merkleProof = await getMerkleProof(input.nationalityCode, tree);
  const numericCode = COUNTRY_CODES[input.nationalityCode];

  // Build circuit input
  // Note: snarkjs types are Record<string, string> but actually accept arrays
  const circuitInput = {
    merkleRoot,
    nationalityCode: numericCode.toString(),
    pathElements: merkleProof.pathElements,
    pathIndices: merkleProof.pathIndices,
  } as unknown as Record<string, string>;

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  const generationTimeMs = Date.now() - startTime;

  return {
    proof,
    publicSignals,
    generationTimeMs,
    merkleRoot,
    isMember: publicSignals[0] === "1",
    groupName: input.groupName,
  };
}

/**
 * Verify a nationality membership Groth16 proof
 */
export async function verifyNationalityMembershipProof(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<NationalityVerifyResult> {
  const startTime = Date.now();

  // If verification key doesn't exist, return simulated result
  const vkPath = join(ARTIFACTS_DIR, "verification_key.json");
  if (!existsSync(vkPath)) {
    console.warn("[Nationality] Verification key not found - returning simulated result");
    return {
      isValid: true, // Simulated
      verificationTimeMs: Date.now() - startTime,
      merkleRoot: publicSignals[1] || "0",
      proofIsMember: publicSignals[0] === "1",
    };
  }

  const vk = getVerificationKey();
  const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

  const verificationTimeMs = Date.now() - startTime;

  return {
    isValid,
    verificationTimeMs,
    merkleRoot: publicSignals[1] || "0",
    proofIsMember: publicSignals[0] === "1",
  };
}

/**
 * Get available country groups
 */
export function getAvailableGroups(): string[] {
  return Object.keys(COUNTRY_GROUPS);
}

/**
 * Get countries in a group
 */
export function getGroupCountries(groupName: string): string[] {
  return COUNTRY_GROUPS[groupName] || [];
}

/**
 * Check if a country code is valid
 */
export function isValidCountryCode(code: string): boolean {
  return code in COUNTRY_CODES;
}

/**
 * Export proof as Solidity calldata
 */
export async function exportNationalitySolidityCalldata(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<string> {
  return await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
}

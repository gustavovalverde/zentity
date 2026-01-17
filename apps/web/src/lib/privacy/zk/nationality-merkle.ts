/**
 * Nationality Merkle Tree using Poseidon2 (SERVER-SIDE)
 *
 * Builds Merkle trees for country groups using Poseidon2 hash (compatible with nodash::poseidon2).
 * Uses BarretenbergSync from @aztec/bb.js for Poseidon2 hashing.
 *
 * NOTE: For client-side proof generation, use generateNationalityProofClientWorker()
 * which computes Merkle paths in the browser without sending nationality to server.
 */

import { Fr } from "@aztec/bb.js";

import { getBarretenberg } from "@/lib/privacy/crypto/barretenberg";

import { COUNTRY_CODES, COUNTRY_GROUPS, TREE_DEPTH } from "./nationality-data";

/**
 * Convert Fr field element to bigint
 */
function frToBigInt(fr: Fr): bigint {
  // Fr.toString() returns "0x..." hex string
  const hexStr = fr.toString();
  return BigInt(hexStr);
}

/**
 * Hash a single value using Poseidon2 (matches nodash::poseidon2([value]))
 */
async function poseidon2Hash(values: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const frValues = values.map((v) => new Fr(v));
  const result = bb.poseidon2Hash(frValues);
  return frToBigInt(result);
}

/**
 * Build a Merkle tree from a list of country codes
 * Returns the root and leaf hashes
 */
async function buildMerkleTree(countryCodes: number[]): Promise<{
  root: bigint;
  leaves: bigint[];
  leafIndices: Map<number, number>;
}> {
  // Pad to power of 2 size (2^TREE_DEPTH = 256)
  const treeSize = 2 ** TREE_DEPTH;
  const paddedCodes = [...countryCodes];
  while (paddedCodes.length < treeSize) {
    paddedCodes.push(0); // Pad with zeros
  }

  // Build leaf hashes and index map
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

  // Build tree level by level
  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parent = await poseidon2Hash([left, right]);
      nextLevel.push(parent);
    }
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0],
    leaves,
    leafIndices,
  };
}

/**
 * Generate a Merkle proof for a country code
 */
async function generateMerkleProof(
  countryCodes: number[],
  targetCode: number
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

  // Build all levels of the tree
  const levels: bigint[][] = [];

  // Level 0: leaves
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

  // Build higher levels
  let currentLevel = leaves;
  while (currentLevel.length > 1) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parent = await poseidon2Hash([left, right]);
      nextLevel.push(parent);
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  // Extract path elements and indices
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
  return {
    pathElements,
    pathIndices,
    merkleRoot: root[0],
    leafIndex,
  };
}

// Cache for Merkle roots (computed once)
const merkleRootCache = new Map<string, bigint>();

/**
 * Get the Merkle root for a country group
 */
export async function getMerkleRoot(groupName: string): Promise<bigint> {
  const upperGroup = groupName.toUpperCase();
  const cached = merkleRootCache.get(upperGroup);
  if (cached !== undefined) {
    return cached;
  }

  const countries = COUNTRY_GROUPS[upperGroup];
  if (!countries) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  const codes = countries.map((c) => COUNTRY_CODES[c]);
  const { root } = await buildMerkleTree(codes);
  merkleRootCache.set(upperGroup, root);
  return root;
}

/**
 * Generate Merkle proof inputs for the Noir circuit
 */
export async function generateNationalityProofInputs(
  nationalityCode: string,
  groupName: string
): Promise<{
  nationalityCodeNumeric: number;
  merkleRoot: string;
  pathElements: string[];
  pathIndices: number[];
}> {
  const upperCode = nationalityCode.toUpperCase();
  const upperGroup = groupName.toUpperCase();

  const numericCode = COUNTRY_CODES[upperCode];
  if (numericCode === undefined) {
    throw new Error(`Unknown nationality code: ${nationalityCode}`);
  }

  const countries = COUNTRY_GROUPS[upperGroup];
  if (!countries) {
    throw new Error(`Unknown country group: ${groupName}`);
  }

  if (!countries.includes(upperCode)) {
    throw new Error(`${nationalityCode} is not a member of ${groupName}`);
  }

  const codes = countries.map((c) => COUNTRY_CODES[c]);
  const proof = await generateMerkleProof(codes, numericCode);

  return {
    nationalityCodeNumeric: numericCode,
    merkleRoot: `0x${proof.merkleRoot.toString(16)}`,
    pathElements: proof.pathElements.map((e) => `0x${e.toString(16)}`),
    pathIndices: proof.pathIndices,
  };
}

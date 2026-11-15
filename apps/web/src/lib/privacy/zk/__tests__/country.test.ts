import { getCountryWeightedSum, poseidon2 } from "@zkpassport/utils";
import { describe, expect, it } from "vitest";

import { buildNationalityTree, COUNTRY_GROUPS } from "../country";

const DEPTH = 8;
const toHex = (value: bigint) => `0x${value.toString(16)}`;
const hash = (values: bigint[]) => poseidon2(values);
const weightedSum = (alpha3: string) =>
  getCountryWeightedSum(alpha3 as Parameters<typeof getCountryWeightedSum>[0]);

/**
 * Level-by-level Poseidon2 tree that the nationality_membership circuit
 * mirrors: leaf = hash([code]) with unused leaves hash([0]), parent = hash([l, r]).
 */
async function referenceTree(group: readonly string[]) {
  const codes = group.map(weightedSum);
  while (codes.length < 2 ** DEPTH) {
    codes.push(0);
  }
  const levels: bigint[][] = [];
  let level: bigint[] = [];
  for (const code of codes) {
    level.push(await hash([BigInt(code)]));
  }
  levels.push(level);
  while (level.length > 1) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await hash([level[i] as bigint, level[i + 1] as bigint]));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function referencePath(levels: bigint[][], leafIndex: number) {
  const pathElements: string[] = [];
  const pathIndices: number[] = [];
  let idx = leafIndex;
  for (let depth = 0; depth < DEPTH; depth++) {
    const isRight = idx % 2 === 1;
    pathElements.push(
      toHex((levels[depth] as bigint[])[isRight ? idx - 1 : idx + 1] as bigint)
    );
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

describe("buildNationalityTree", () => {
  for (const groupName of ["EU", "FIVE_EYES", "GLOBAL"] as const) {
    it(`matches the level-by-level reference for every ${groupName} member`, async () => {
      const group = COUNTRY_GROUPS[groupName];
      const levels = await referenceTree(group);
      const root = toHex((levels.at(-1) as bigint[])[0] as bigint);
      const tree = await buildNationalityTree(groupName, hash);

      for (const [index, alpha3] of group.entries()) {
        expect(tree.prove(alpha3)).toEqual({
          merkleRoot: root,
          nationalityCode: weightedSum(alpha3),
          ...referencePath(levels, index),
        });
      }
    }, 60_000);
  }

  it("accepts lowercase group and country codes", async () => {
    const tree = await buildNationalityTree("eu", hash);
    expect(tree.prove("deu")).toEqual(
      (await buildNationalityTree("EU", hash)).prove("DEU")
    );
  });

  it("rejects unknown groups and non-members", async () => {
    await expect(buildNationalityTree("NOPE", hash)).rejects.toThrow(
      "Unknown country group"
    );
    const tree = await buildNationalityTree("FIVE_EYES", hash);
    expect(() => tree.prove("DEU")).toThrow("not a member");
  });
});

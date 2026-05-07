import { describe, expect, it } from "vitest";

import {
  computeHumanSignalSubjectHash,
  computeHumanUniquenessNullifier,
} from "../human-signal";

const SECRET = "test-human-signal-secret-minimum-32-chars";
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

describe("human signal privacy identifiers", () => {
  it("hashes provider subjects with provider and subject-kind separation", () => {
    const subjectHash = computeHumanSignalSubjectHash({
      secret: SECRET,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubject:
        "0x1111aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
    });

    expect(subjectHash).toMatch(SHA256_HEX_RE);
    expect(subjectHash).toBe(
      computeHumanSignalSubjectHash({
        secret: SECRET,
        provider: "world_id",
        providerSubjectKind: "nullifier",
        providerSubject:
          "0x1111aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
      })
    );
    expect(subjectHash).not.toBe(
      computeHumanSignalSubjectHash({
        secret: SECRET,
        provider: "world_id",
        providerSubjectKind: "nullifier",
        providerSubject:
          "0x9999aaaabbbbccccddddeeeeffff0000111122223333444455556666777788881111",
      })
    );
  });

  it("derives per-client human uniqueness nullifiers from the stored subject hash", () => {
    const providerSubjectHash = computeHumanSignalSubjectHash({
      secret: SECRET,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubject:
        "0x1111aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999",
    });

    const primaryClient = computeHumanUniquenessNullifier({
      secret: SECRET,
      provider: "world_id",
      providerSubjectHash,
      clientId: "client-a",
    });
    const secondCall = computeHumanUniquenessNullifier({
      secret: SECRET,
      provider: "world_id",
      providerSubjectHash,
      clientId: "client-a",
    });
    const secondaryClient = computeHumanUniquenessNullifier({
      secret: SECRET,
      provider: "world_id",
      providerSubjectHash,
      clientId: "client-b",
    });

    expect(primaryClient).toMatch(SHA256_HEX_RE);
    expect(primaryClient).toBe(secondCall);
    expect(primaryClient).not.toBe(secondaryClient);
    expect(primaryClient).not.toBe(providerSubjectHash);
  });
});

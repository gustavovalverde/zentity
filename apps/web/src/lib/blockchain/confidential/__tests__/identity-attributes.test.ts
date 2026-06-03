import type { EncryptResult } from "@zama-fhe/sdk";

import { describe, expect, it } from "vitest";

import {
  buildEncryptedIdentityAttributes,
  buildIdentityAttributeDecryptHandles,
  deriveDecryptedIdentityAttributes,
  resolveIdentityAttributeHandles,
} from "../identity-attributes";

const HANDLES = {
  birthYearOffset: "0x01",
  countryCode: "0x02",
  complianceLevel: "0x03",
  isBlacklisted: "0x04",
} as const;

describe("buildEncryptedIdentityAttributes", () => {
  it("maps encrypt handles to attributes in registry order", () => {
    const encryptResult: EncryptResult = {
      handles: [
        Uint8Array.of(1),
        Uint8Array.of(2),
        Uint8Array.of(3),
        Uint8Array.of(4),
      ],
      inputProof: Uint8Array.of(0xab, 0xcd),
    };

    expect(buildEncryptedIdentityAttributes(encryptResult)).toEqual({
      birthYearOffset: "0x01",
      countryCode: "0x02",
      complianceLevel: "0x03",
      isBlacklisted: "0x04",
      inputProof: "0xabcd",
    });
  });

  it("throws naming the attribute whose handle is absent", () => {
    const encryptResult = {
      handles: [Uint8Array.of(1), Uint8Array.of(2)],
      inputProof: Uint8Array.of(1),
    } as EncryptResult;

    expect(() => buildEncryptedIdentityAttributes(encryptResult)).toThrow(
      "compliance level"
    );
  });
});

describe("resolveIdentityAttributeHandles", () => {
  it("normalizes every handle when all are present", () => {
    expect(
      resolveIdentityAttributeHandles({
        birthYearOffset: "01",
        countryCode: "0x02",
        complianceLevel: Uint8Array.of(3),
        isBlacklisted: "0x04",
      })
    ).toEqual(HANDLES);
  });

  it("returns null when any handle is missing", () => {
    expect(
      resolveIdentityAttributeHandles({
        birthYearOffset: "0x01",
        countryCode: undefined,
        complianceLevel: "0x03",
        isBlacklisted: "0x04",
      })
    ).toBeNull();
  });
});

describe("buildIdentityAttributeDecryptHandles", () => {
  it("pairs each handle with the registry address in order", () => {
    const registryAddress = "0x000000000000000000000000000000000000dEaD";

    expect(
      buildIdentityAttributeDecryptHandles({
        attributeHandles: HANDLES,
        registryAddress,
      })
    ).toEqual([
      { handle: "0x01", contractAddress: registryAddress },
      { handle: "0x02", contractAddress: registryAddress },
      { handle: "0x03", contractAddress: registryAddress },
      { handle: "0x04", contractAddress: registryAddress },
    ]);
  });
});

describe("deriveDecryptedIdentityAttributes", () => {
  it("reads each clear value by its handle and coerces types", () => {
    expect(
      deriveDecryptedIdentityAttributes({
        attributeHandles: HANDLES,
        clearValues: { "0x01": 7n, "0x02": 840n, "0x03": 3n, "0x04": true },
      })
    ).toEqual({
      birthYearOffset: 7,
      countryCode: 840,
      complianceLevel: 3,
      isBlacklisted: true,
    });
  });

  it("defaults absent clear values to zero and false", () => {
    expect(
      deriveDecryptedIdentityAttributes({
        attributeHandles: HANDLES,
        clearValues: {},
      })
    ).toEqual({
      birthYearOffset: 0,
      countryCode: 0,
      complianceLevel: 0,
      isBlacklisted: false,
    });
  });
});

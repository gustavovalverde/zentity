import { describe, expect, it } from "vitest";

import { buildDisclosurePayload } from "../disclosure-client";

describe("disclosure-client", () => {
  it("throws if profile is missing", () => {
    expect(() =>
      buildDisclosurePayload({
        profile: null,
        scope: ["fullName"],
        rpId: "rp",
        packageId: "pkg",
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      })
    ).toThrow("Missing profile data for disclosure.");
  });

  it("builds a payload including address fields", () => {
    const { payload, encryptedFields } = buildDisclosurePayload({
      profile: {
        fullName: "Test User",
        dateOfBirth: "1990-01-01",
        residentialAddress: "123 Main St, City, ST 12345",
        addressCountryCode: "USA",
        updatedAt: new Date().toISOString(),
      },
      scope: [
        "fullName",
        "dateOfBirth",
        "residentialAddress",
        "addressCountryCode",
      ],
      rpId: "rp",
      packageId: "pkg",
      createdAt: "2026-01-17T00:00:00.000Z",
      expiresAt: "2026-01-18T00:00:00.000Z",
    });

    expect(encryptedFields).toEqual([
      "fullName",
      "dateOfBirth",
      "residentialAddress",
      "addressCountryCode",
    ]);

    expect(payload).toMatchObject({
      rpId: "rp",
      packageId: "pkg",
      createdAt: "2026-01-17T00:00:00.000Z",
      expiresAt: "2026-01-18T00:00:00.000Z",
      fullName: "Test User",
      dateOfBirth: "1990-01-01",
      residentialAddress: "123 Main St, City, ST 12345",
      addressCountryCode: "USA",
    });
  });

  it("throws when a scoped field is missing from the profile", () => {
    expect(() =>
      buildDisclosurePayload({
        profile: {
          fullName: "Test User",
          updatedAt: new Date().toISOString(),
        },
        scope: ["residentialAddress"],
        rpId: "rp",
        packageId: "pkg",
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      })
    ).toThrow("Missing required profile fields: residentialAddress.");
  });
});

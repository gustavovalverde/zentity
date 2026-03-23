import { describe, expect, it } from "vitest";

import {
  buildProfileSecretDataFromOcrSnapshot,
  buildProfileSecretDataFromPassportDisclosure,
} from "../profile-vault";

describe("profile-vault helpers", () => {
  it("maps OCR verification data to the shared profile secret shape", () => {
    expect(
      buildProfileSecretDataFromOcrSnapshot({
        extractedName: "Ada Lovelace",
        extractedFirstName: "Ada",
        extractedLastName: "Lovelace",
        extractedDOB: "1815-12-10",
        extractedDocNumber: "ABC123",
        extractedNationality: "British",
        extractedNationalityCode: "GBR",
        extractedExpirationDate: "20300101",
        userSalt: "salt-1",
      })
    ).toEqual({
      extractedFullName: "Ada Lovelace",
      extractedFirstName: "Ada",
      extractedLastName: "Lovelace",
      extractedDOB: "1815-12-10",
      extractedDocumentNumber: "ABC123",
      extractedNationality: "British",
      extractedNationalityCode: "GBR",
      extractedExpirationDate: 20_300_101,
      userSalt: "salt-1",
    });
  });

  it("maps passport disclosure data to the shared profile secret shape", () => {
    expect(
      buildProfileSecretDataFromPassportDisclosure({
        fullName: "Ada Lovelace",
        dateOfBirth: "1815-12-10",
        nationality: "British",
        nationalityCode: "GBR",
        documentType: "passport",
        issuingCountry: "GBR",
      })
    ).toEqual({
      extractedFullName: "Ada Lovelace",
      extractedDOB: "1815-12-10",
      extractedNationality: "British",
      extractedNationalityCode: "GBR",
      extractedDocumentType: "passport",
      extractedDocumentOrigin: "GBR",
    });
  });
});

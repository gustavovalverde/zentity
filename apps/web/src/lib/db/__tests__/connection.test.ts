import { describe, expect, it } from "vitest";

import { sqlite } from "@/lib/db/connection";

function getTableNames(): string[] {
  const rows = sqlite
    .query("select name from sqlite_master where type = 'table'")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

describe("db connection", () => {
  it("runs migrations and creates core tables", () => {
    const tableNames = getTableNames();

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "user",
        "identity_documents",
        "identity_bundles",
        "identity_verification_drafts",
        "identity_verification_jobs",
        "zk_proofs",
        "encrypted_attributes",
        "signed_claims",
        "zk_challenges",
        "attestation_evidence",
        "blockchain_attestations",
        "onboarding_sessions",
        "rp_authorization_codes",
      ]),
    );
  });
});

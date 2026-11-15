import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";

// The foreign-key columns of the production schema (release 5b4283aa). SQLite
// refuses `ALTER TABLE ... DROP COLUMN` for a column that a foreign key names,
// so dropping one from a table the schema keeps makes `pnpm db:push` fail on
// production: the batch rolls back, and drizzle-kit still exits 0.
const PRODUCTION_FOREIGN_KEY_COLUMNS: Record<string, readonly string[]> = {
  account: ["userId"],
  agent_host: ["client_id", "user_id"],
  agent_host_policy: ["capability_name", "granted_by", "host_id"],
  agent_session: ["auth_context_id", "host_id"],
  agent_session_grant: [
    "capability_name",
    "granted_by",
    "host_policy_id",
    "session_id",
  ],
  agent_token_snapshot: ["agent_session_id", "client_id", "host_id"],
  attestation_evidence: ["user_id"],
  auth_challenge_session: ["client_id", "resolved_auth_context_id", "user_id"],
  authentication_context: ["user_id"],
  blockchain_attestations: ["user_id"],
  capability_usage_ledger: [
    "capability_name",
    "host_policy_id",
    "session_grant_id",
    "session_id",
  ],
  ciba_request: [
    "agent_session_id",
    "auth_context_id",
    "client_id",
    "host_id",
    "user_id",
  ],
  credential_binding_commitments: ["secret_id", "user_id"],
  encrypted_attributes: ["user_id"],
  encrypted_secrets: ["user_id"],
  humanity_challenges: ["user_id"],
  humanity_credentials: ["user_id"],
  identity_bundles: ["effective_verification_id", "user_id"],
  identity_validity_deliveries: ["event_id", "user_id"],
  identity_validity_events: ["user_id", "verification_id"],
  identity_verification_drafts: ["user_id"],
  identity_verification_jobs: ["user_id"],
  identity_verification_sessions: ["user_id"],
  identity_verifications: ["superseded_by_verification_id", "user_id"],
  invitation: ["inviterId", "organizationId"],
  member: ["organizationId", "userId"],
  oauth_access_token: ["auth_context_id", "client_id", "refresh_id", "user_id"],
  oauth_client: ["user_id"],
  oauth_client_resource: ["client_id", "resource_id"],
  oauth_consent: ["client_id", "user_id"],
  oauth_pending_disclosure: ["client_id", "user_id"],
  oauth_refresh_token: ["auth_context_id", "client_id", "user_id"],
  oidc4vci_issued_credential: ["user_id"],
  oidc4vci_offer: ["user_id"],
  oidc_release_context: ["client_id", "user_id"],
  passkey: ["userId"],
  proof_artifacts: ["proof_session_id", "user_id"],
  proof_sessions: ["user_id"],
  push_subscription: ["user_id"],
  secret_wrappers: ["secret_id", "user_id"],
  session: ["authContextId", "userId"],
  signed_claims: ["user_id"],
  two_factor: ["user_id"],
  used_agent_assertion_jti: ["session_id"],
  verification_checks: ["user_id"],
  wallet_address: ["user_id"],
  zk_challenges: ["proof_session_id"],
};

describe("pnpm db:push onto the production schema", () => {
  it("keeps every foreign-key column of the tables it keeps", async () => {
    const rows = await db.all<{ table_name: string; column_name: string }>(
      sql`SELECT m.name AS table_name, p.name AS column_name
        FROM sqlite_master m, pragma_table_info(m.name) p
        WHERE m.type = 'table'`
    );
    const columns = new Map<string, Set<string>>();
    for (const row of rows) {
      const tableColumns = columns.get(row.table_name) ?? new Set<string>();
      tableColumns.add(row.column_name);
      columns.set(row.table_name, tableColumns);
    }

    const dropped = Object.entries(PRODUCTION_FOREIGN_KEY_COLUMNS).flatMap(
      ([table, foreignKeyColumns]) => {
        const kept = columns.get(table);
        return kept
          ? foreignKeyColumns
              .filter((column) => !kept.has(column))
              .map((column) => `${table}.${column}`)
          : [];
      }
    );
    expect(dropped).toEqual([]);
  });
});

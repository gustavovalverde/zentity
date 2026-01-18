# RFC-0002: Drizzle ORM Migration

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-29 |
| **Author** | Gustavo Valverde |

> Note: The repo uses `bun run db:push` for schema application and does not commit migration files.

## Summary

Replace the manual SQL layer (`src/lib/db/db.ts`) with Drizzle ORM using libsql for both local files and Turso, and apply schema via `drizzle-kit push` (no committed migrations).

## Problem Statement

The current database layer has several critical issues:

1. **No Transaction Boundaries**: Only 1 explicit transaction exists in the entire codebase (`consumeRpAuthorizationCode`). Multi-table operations (identity verification, attestation creation) lack atomicity:

   ```typescript
   // Current: Not atomic - partial failure leaves inconsistent state
   insertZkProofRecord(userId, documentId, proof);
   insertSignedClaim(userId, documentId, claim);
   upsertAttestationEvidence(userId, evidence);
   ```

2. **109 Manual `db.prepare()` Calls**: All queries are hand-written SQL with manual parameter binding:

   ```typescript
   const stmt = db.prepare(`
     SELECT * FROM identity_documents
     WHERE user_id = ? AND verified = 1
   `);
   const result = stmt.get(userId) as IdentityDocument | undefined;
   ```

3. **Silent Migration Failures**: Runtime schema updates wrapped in try-catch:

   ```typescript
   for (const col of columnsToAdd) {
     try {
       db.run(`ALTER TABLE ... ADD COLUMN ${col.name} ${col.type}`);
     } catch {
       // Silently ignored - no visibility into success/failure
     }
   }
   ```

4. **No Compile-Time Type Safety**: Manual interfaces with `as` casting:

   ```typescript
   const row = stmt.get(userId) as IdentityBundle | undefined; // No validation
   ```

5. **Monolithic File**: 1,886 lines mixing schema, queries, encryption utilities, and table initialization.

## Design Decisions

- **ORM Choice**: Drizzle ORM over Prisma/Kysely
  - LibSQL adapter (`drizzle-orm/libsql`) for both local file URLs and Turso
  - SQL-like syntax (minimal learning curve)
  - Lightweight (no codegen, no runtime overhead)
  - Full transaction support with rollback
  - Type inference from schema (no separate type definitions)

- **Migration Strategy**: Aggressive rewrite (not incremental)
  - This is a PoC with no production data
  - Delete old files entirely rather than wrapping
  - Schema applied via `drizzle-kit push` (no migration files committed)

- **Schema Organization**: Domain-driven vertical slices
  - `schema/identity.ts` for identity verification
  - `schema/crypto.ts` for ZK proofs and FHE
  - `schema/attestation.ts` for blockchain attestations
  - Matches existing feature boundaries

## Architecture Overview

### Current Structure (Delete)

```text
src/lib/db/
├── db.ts           # 1,886 lines - everything
├── sqlite.ts       # Connection management
└── index.ts        # Re-exports
```

### New Structure

```text
src/lib/db/
├── connection.ts           # Drizzle client + pragmas
├── schema/
│   ├── identity.ts         # identity_bundles, identity_documents
│   ├── crypto.ts           # zk_proofs, encrypted_attributes, signed_claims, zk_challenges
│   ├── attestation.ts      # attestation_evidence, blockchain_attestations
│   ├── sign-up.ts          # sign_up_sessions
│   ├── rp.ts               # rp_authorization_codes
│   └── index.ts            # Re-export all tables
├── queries/
│   ├── identity.ts         # getVerificationStatus, getSelectedDocument, etc.
│   ├── crypto.ts           # insertZkProof, getEncryptedAttribute, etc.
│   ├── attestation.ts      # upsertEvidence, getBlockchainAttestation, etc.
│   ├── sign-up.ts          # Session CRUD
│   ├── rp.ts               # Authorization code CRUD
│   └── index.ts            # Re-export all queries
├── drizzle.config.ts       # Drizzle Kit configuration
└── index.ts                # Public API
```

### Schema Example

```typescript
// src/lib/db/schema/identity.ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth"; // Better Auth's user table

export const identityBundles = sqliteTable("identity_bundles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  walletAddress: text("wallet_address"),
  status: text("status").default("pending"),
  policyVersion: text("policy_version"),
  fheKeyId: text("fhe_key_id"),
  fhePublicKey: text("fhe_public_key"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  statusIdx: index("idx_identity_bundles_status").on(table.status),
}));

export const identityDocuments = sqliteTable("identity_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentHash: text("document_hash").notNull().unique(),
  fullNameCommitment: text("full_name_commitment"),
  dobCommitment: text("dob_commitment"),
  expiryCommitment: text("expiry_commitment"),
  nationalityCommitment: text("nationality_commitment"),
  issuingCountryCommitment: text("issuing_country_commitment"),
  verified: integer("verified", { mode: "boolean" }).default(false),
  selected: integer("selected", { mode: "boolean" }).default(false),
  status: text("status").default("pending"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  userIdIdx: index("idx_identity_documents_user_id").on(table.userId),
  documentHashIdx: index("idx_identity_documents_hash").on(table.documentHash),
}));

// Type inference - no manual interfaces needed
export type IdentityBundle = typeof identityBundles.$inferSelect;
export type NewIdentityBundle = typeof identityBundles.$inferInsert;
export type IdentityDocument = typeof identityDocuments.$inferSelect;
export type NewIdentityDocument = typeof identityDocuments.$inferInsert;
```

### Transaction Example

```typescript
// src/lib/db/queries/identity.ts
import { db } from "../connection";
import { identityDocuments, identityBundles } from "../schema";
import { zkProofs, signedClaims } from "../schema/crypto";
import { eq, and } from "drizzle-orm";

export async function completeIdentityVerification(
  userId: string,
  document: NewIdentityDocument,
  proofs: NewZkProof[],
  claims: NewSignedClaim[]
) {
  // All-or-nothing: if any insert fails, entire transaction rolls back
  return db.transaction((tx) => {
    // Insert document
    tx.insert(identityDocuments).values(document).run();

    // Insert all proofs
    for (const proof of proofs) {
      tx.insert(zkProofs).values(proof).run();
    }

    // Insert all claims
    for (const claim of claims) {
      tx.insert(signedClaims).values(claim).run();
    }

    // Update bundle status
    tx.update(identityBundles)
      .set({ status: "verified", updatedAt: new Date().toISOString() })
      .where(eq(identityBundles.userId, userId))
      .run();

    return { success: true };
  });
}
```

### Query Examples

```typescript
// Type-safe queries with full autocomplete
import { eq, and, desc } from "drizzle-orm";

// Select with type inference
const document = db
  .select()
  .from(identityDocuments)
  .where(and(
    eq(identityDocuments.userId, userId),
    eq(identityDocuments.verified, true),
    eq(identityDocuments.selected, true)
  ))
  .get();
// document is typed as IdentityDocument | undefined

// Insert with validation
db.insert(zkProofs).values({
  id: crypto.randomUUID(),
  userId,
  documentId,
  proofType: "age_verification",
  proofHash: hash,
  verified: true,
  // TypeScript error if required field missing
}).run();

// Update with returning
const updated = db
  .update(identityBundles)
  .set({ status: "verified" })
  .where(eq(identityBundles.userId, userId))
  .returning()
  .get();
```

## Implementation Steps

### Step 1: Add Dependencies

```bash
cd apps/web
bun add drizzle-orm
bun add -D drizzle-kit
```

### Step 2: Create Connection Module

```typescript
// src/lib/db/connection.ts
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

function isBuildTime() {
  if (process.env.npm_lifecycle_event === "build") {
    return true;
  }
  const argv = process.argv.join(" ");
  return argv.includes("next") && argv.includes("build");
}

function getDatabaseUrl(): string {
  if (isBuildTime()) {
    return "file::memory:";
  }
  return process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
}

const client = createClient({
  url: getDatabaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
```

### Step 3: Create Schema Files

Create schema files for each domain (see Architecture section):

- `schema/identity.ts` - identity_bundles, identity_documents
- `schema/crypto.ts` - zk_proofs, encrypted_attributes, signed_claims, zk_challenges
- `schema/attestation.ts` - attestation_evidence, blockchain_attestations
- `schema/sign-up.ts` - sign_up_sessions
- `schema/rp.ts` - rp_authorization_codes

### Step 4: Configure Drizzle Kit

```typescript
// apps/web/drizzle.config.ts
const url = process.env.TURSO_DATABASE_URL || "file:./.data/dev.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

export default {
  schema: "./src/lib/db/schema/index.ts",
  dialect: "turso",
  dbCredentials: authToken
    ? {
        url,
        authToken,
      }
    : {
        url,
      },
};
```

### Step 5: Apply Schema

```bash
bun run db:push:dev
```

### Step 6: Create Query Modules

Migrate each query function from `db.ts` to appropriate query module:

| Old Function | New Location |
|--------------|--------------|
| `getVerificationStatus()` | `queries/identity.ts` |
| `getSelectedIdentityDocument()` | `queries/identity.ts` |
| `insertZkProofRecord()` | `queries/crypto.ts` |
| `insertSignedClaim()` | `queries/crypto.ts` |
| `upsertAttestationEvidence()` | `queries/attestation.ts` |
| `createSignUpSession()` | `queries/sign-up.ts` |
| `consumeRpAuthorizationCode()` | `queries/rp.ts` |

### Step 7: Add Transaction Boundaries

Identify multi-table operations and wrap in transactions:

1. **Identity Verification** (document + proofs + claims + bundle update)
2. **Attestation Creation** (evidence + blockchain_attestations)
3. **User Deletion** (GDPR - cascade all related data)
4. **Document Selection** (deselect old + select new)

### Step 8: Update Imports

Update all tRPC routers to import from new query modules:

```typescript
// Before
import { getVerificationStatus, insertZkProofRecord } from "@/lib/db";

// After
import { getVerificationStatus } from "@/lib/db/queries/identity";
import { insertZkProofRecord } from "@/lib/db/queries/crypto";
```

### Step 9: Delete Old Files

```bash
rm src/lib/db/db.ts
rm src/lib/db/sqlite.ts
```

### Step 10: Update Tests

Update test imports and add transaction rollback for test isolation:

```typescript
// vitest.setup.mts
import { db } from "@/lib/db/connection";

beforeEach(() => {
  // Start transaction for test isolation
  db.run(sql`BEGIN`);
});

afterEach(() => {
  // Rollback to clean state
  db.run(sql`ROLLBACK`);
});
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/db/connection.ts` | Create | Drizzle client with pragmas |
| `src/lib/db/schema/identity.ts` | Create | Identity tables |
| `src/lib/db/schema/crypto.ts` | Create | Crypto tables |
| `src/lib/db/schema/attestation.ts` | Create | Attestation tables |
| `src/lib/db/schema/sign-up.ts` | Create | Sign-up table |
| `src/lib/db/schema/rp.ts` | Create | RP auth codes table |
| `src/lib/db/schema/index.ts` | Create | Re-export all schemas |
| `src/lib/db/queries/identity.ts` | Create | Identity query functions |
| `src/lib/db/queries/crypto.ts` | Create | Crypto query functions |
| `src/lib/db/queries/attestation.ts` | Create | Attestation queries |
| `src/lib/db/queries/sign-up.ts` | Create | Sign-up queries |
| `src/lib/db/queries/rp.ts` | Create | RP auth queries |
| `src/lib/db/queries/index.ts` | Create | Re-export all queries |
| `src/lib/db/index.ts` | Modify | New public API |
| `drizzle.config.ts` | Create | Drizzle Kit config |
| `src/lib/db/db.ts` | Delete | Old monolithic file |
| `src/lib/db/sqlite.ts` | Delete | Old connection |
| `src/lib/trpc/routers/*.ts` | Modify | Update imports |
| `vitest.setup.mts` | Modify | Add transaction isolation |

## Security Considerations

1. **Parameterized Queries**: Drizzle uses parameterized statements by default - SQL injection protection maintained
2. **Type Safety**: Compile-time validation prevents malformed queries
3. **Transaction Isolation**: Proper boundaries prevent partial data exposure
4. **Encryption Utilities**: Move `encryptFirstName()`, `decryptFirstName()` to dedicated `src/lib/crypto/pii-encryption.ts`

## Technical Notes

- **Better Auth Compatibility**: Drizzle can reference Better Auth's tables via `drizzle-orm` relations
- **Build-Time Handling**: Maintain `:memory:` database for `next build` to avoid SQLite lock contention
- **No Data Migration**: This is a PoC - we'll recreate schema from scratch
- **Index Preservation**: All existing indexes recreated in Drizzle schema

## Package Changes

```json
{
  "dependencies": {
    "drizzle-orm": "^0.38.x"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.x"
  }
}
```

## References

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Drizzle with Bun SQLite](https://orm.drizzle.team/docs/get-started/bun-sqlite-new)
- [Drizzle Transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle Kit Push](https://orm.drizzle.team/docs/drizzle-kit-push)

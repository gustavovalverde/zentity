---
status: "accepted"
date: "2026-03-24"
builds-on: "[Consent-based disclosure](0004-consent-based-disclosure.md)"
category: "technical"
domains: [privacy, security, platform]
---

# Volatile in-memory store for identity release staging

## Context and Problem Statement

Zentity's identity release flow stages decrypted PII (name, address, date of birth) between a user's explicit vault-unlock action and the relying party's subsequent `userinfo` call. This staging window is 5 minutes for OAuth consent and 10 minutes for CIBA approval. The question is whether this staging store should use durable persistence (database, Redis) or volatile process memory.

Two stores handle staging:

- **`ephemeral-identity-claims.ts`** — Decrypted profile data from the user's credential-wrapped vault (passkey PRF, OPAQUE export key, or wallet signature). Used by OAuth consent and CIBA approval flows.
- **`claims-parameter.ts`** — The OIDC `claims` request parameter (Section 5.5) between authorization and token/userinfo. Controls which claims are released.

Both use single-consume semantics: data is deleted on first read.

## Priorities & Constraints

- PII must never touch durable storage between stage and consume — no DB, no WAL, no replication log
- Single-consume semantics must hold (one reader, one delivery)
- Replay protection must survive process restarts (handled separately via durable JTI table)
- Store must survive Next.js HMR in development

## Decision Outcome

Chosen option: volatile process-scoped memory via `globalThis[Symbol.for(...)]`.

PII exists only in volatile process memory for at most 10 minutes. Process termination is a complete data wipe. This is a privacy feature, not a reliability gap — it aligns with the platform's core principle that data which doesn't exist can't be breached.

Replay protection is handled separately by the durable `used_intent_jtis` table, which stores only opaque UUIDs and expiry timestamps (no PII).

### Expected Consequences

- Raw PII exists only in process memory. No disk, no WAL, no replica, no backup trace.
- The only way to extract staged PII is live process memory access, which implies full server compromise.
- **Single-process deployment is an architectural invariant.** Multi-replica deployments without sticky sessions cause silent PII delivery failure (empty userinfo response, not a data leak). If horizontal scaling becomes necessary, sticky sessions preserve this invariant.
- Process crashes between stage and consume lose staged data. The user must re-unlock. This is rare (5–10 minute window) and self-healing.
- No audit trail for staged-but-unconsumed entries. Debugging delivery failures requires log correlation.

### What is persisted durably (boundary reference)

| Data | Storage | Contains PII |
|------|---------|-------------|
| Intent JTI replay table | SQLite/Turso | No — opaque UUIDs |
| Consent records | SQLite/Turso | No — scopes only, identity scopes stripped |
| CIBA request metadata | SQLite/Turso | No — agent binding and status |
| Credential-wrapped profile secret | SQLite/Turso | Encrypted — only user can decrypt |
| **Staged identity claims** | **Volatile memory** | **Yes — plaintext PII** |
| **OIDC claims parameter** | **Volatile memory** | **No — controls release** |

## Alternatives Considered

- **Database table with short TTL and encryption at rest.** Rejected: SQLite/Turso WAL writes data to disk before committing. PII would exist in WAL segments, edge replicas (Turso), and backups — recoverable via forensics even after TTL deletion. Encryption at rest adds key management complexity while leaving encrypted blobs in durable storage, creating an oracle for anyone with `KEY_ENCRYPTION_KEY` access.
- **Redis with volatile-TTL eviction.** Rejected for now: weakens the guarantee since the operator gains access to the cache process memory, and Redis snapshots (RDB/AOF) would persist PII if misconfigured. May be reconsidered under a separate ADR if horizontal scaling becomes a hard requirement, with mandatory TLS, no persistence, and network isolation.
- **Plain module-scoped `new Map()`.** Rejected: does not survive Next.js HMR in development (module re-evaluation creates a fresh Map). The `globalThis[Symbol.for(...)]` pattern is stable across HMR cycles because `Symbol.for` returns the same symbol across evaluations.

## More Information

- `apps/web/src/lib/auth/oidc/ephemeral-identity-claims.ts` — PII release store
- `apps/web/src/lib/auth/oidc/claims-parameter.ts` — OIDC claims parameter store
- `apps/web/src/lib/auth/oidc/identity-handler.ts` — Shared intent/stage/unstage handlers
- `apps/web/src/lib/auth/oidc/identity-intent.ts` — HMAC-signed intent token with JTI replay protection
- Privacy architecture: [Attestation & Privacy Architecture](../../(understand)/attestation-privacy-architecture.md)
- Builds on: [Consent-based disclosure](0004-consent-based-disclosure.md), [Passkey-sealed profile](0003-passkey-sealed-profile.md)

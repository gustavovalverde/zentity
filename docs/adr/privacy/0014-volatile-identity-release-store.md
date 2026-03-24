---
status: "accepted"
date: "2026-03-24"
builds-on: "[Consent-based disclosure](0004-consent-based-disclosure.md)"
category: "technical"
domains: [privacy, security, platform]
---

# Volatile in-memory store for plaintext identity release payloads

## Context and Problem Statement

Zentity's identity release flow stages decrypted PII (name, address, date of birth) between a user's explicit vault-unlock action and the relying party's subsequent `userinfo` call. Plaintext identity payloads live for 5 minutes in OAuth pending state and 10 minutes in CIBA/final release state. The question is whether that plaintext staging layer should use durable persistence (database, Redis) or volatile process memory.

The current architecture is hybrid:

- **Volatile only**: plaintext identity payloads in `ephemeral-identity-claims.ts`
- **Durable, non-PII metadata**: exact disclosure binding in `disclosure-context.ts` backed by `oauthPendingDisclosures` and `oidcReleaseContexts`

The durable metadata does not store plaintext PII. It stores release identifiers, user/client binding, approved identity scopes, parsed `claims` requests, scope hashes, and expiry data so token issuance and userinfo can resolve the exact authorization context without heuristics.

## Priorities & Constraints

- Plaintext PII must never touch durable storage between stage and consume — no DB row, no WAL segment, no replica, no backup trace
- Single-consume semantics must hold for plaintext payloads
- Replay protection must survive process restarts (handled separately via durable JTI table)
- Store must survive Next.js HMR in development

## Decision Outcome

Chosen option: volatile process-scoped memory via `globalThis[Symbol.for(...)]` for plaintext payloads only.

Plaintext identity data exists only in volatile process memory for at most 10 minutes. Process termination is a complete data wipe. This is a privacy feature, not a reliability gap. Exact release metadata is durable, but it contains no plaintext PII and exists only to bind token issuance and userinfo to the exact authorization that produced the release.

Replay protection is handled separately by the durable `used_intent_jtis` table, which stores only opaque UUIDs and expiry timestamps (no PII).

### Expected Consequences

- Raw PII exists only in process memory. No disk, no WAL, no replica, no backup trace.
- The only way to extract staged PII is live process memory access, which implies full server compromise.
- **Single-process deployment is still an architectural invariant for plaintext PII.** Multi-replica deployments without sticky sessions can lose the volatile payload, which now fails closed as `invalid_token` for bound releases rather than falling back to another flow.
- Process crashes between stage and consume lose plaintext staged data. The user must re-unlock. Durable release metadata remains, but it cannot recreate the plaintext payload.
- Exact release metadata survives process restarts, which improves diagnosis and prevents heuristic read-time recovery logic from creeping back in.

### What is persisted durably (boundary reference)

| Data | Storage | Contains PII |
|------|---------|-------------|
| Intent JTI replay table | SQLite/Turso | No — opaque UUIDs |
| Consent records | SQLite/Turso | No — scopes only, identity scopes stripped |
| CIBA request metadata | SQLite/Turso | No — agent binding and status |
| Credential-wrapped profile secret | SQLite/Turso | Encrypted — only user can decrypt |
| OAuth pending disclosure metadata | SQLite/Turso | No — release binding only |
| Final release context metadata | SQLite/Turso | No — release binding only |
| **Plaintext staged identity payload** | **Volatile memory** | **Yes — plaintext PII** |

## Alternatives Considered

- **Database table with short TTL and encryption at rest.** Rejected: SQLite/Turso WAL writes data to disk before committing. PII would exist in WAL segments, edge replicas (Turso), and backups — recoverable via forensics even after TTL deletion. Encryption at rest adds key management complexity while leaving encrypted blobs in durable storage, creating an oracle for anyone with `KEY_ENCRYPTION_KEY` access.
- **Redis with volatile-TTL eviction.** Rejected for now: weakens the guarantee since the operator gains access to the cache process memory, and Redis snapshots (RDB/AOF) would persist PII if misconfigured. May be reconsidered under a separate ADR if horizontal scaling becomes a hard requirement, with mandatory TLS, no persistence, and network isolation.
- **Plain module-scoped `new Map()`.** Rejected: does not survive Next.js HMR in development (module re-evaluation creates a fresh Map). The `globalThis[Symbol.for(...)]` pattern is stable across HMR cycles because `Symbol.for` returns the same symbol across evaluations.

## More Information

- `apps/web/src/lib/auth/oidc/ephemeral-identity-claims.ts` — volatile plaintext payload store
- `apps/web/src/lib/auth/oidc/disclosure-context.ts` — durable exact disclosure metadata
- `apps/web/src/lib/auth/oidc/identity-handler.ts` — shared intent/stage/unstage handlers
- `apps/web/src/lib/auth/oidc/identity-intent.ts` — HMAC-signed intent token with JTI replay protection
- Privacy architecture: [Attestation & Privacy Architecture](../../(understand)/attestation-privacy-architecture.md)
- Builds on: [Consent-based disclosure](0004-consent-based-disclosure.md), [Passkey-sealed profile](0003-passkey-sealed-profile.md)

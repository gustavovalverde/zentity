# Task 07: Sybil Deduplication

> Source: `prd-identity-hardening.md` Modules 1 & 2
> Priority: **P1** — OCR path dedup is broken (salt-randomized hash); no cross-method dedup
> Estimate: ~2 days

## Architectural decisions

- **Dedup key**: `HMAC-SHA256(DEDUP_HMAC_SECRET, canonical(document_number) || "|" || issuer_country || "|" || dob)` — deterministic, cross-method
- **`DEDUP_HMAC_SECRET`**: Dedicated env var (min 32 chars), immutable after first verified identity
- **Per-RP nullifier**: `HMAC-SHA256(DEDUP_HMAC_SECRET, dedup_key || "|rp|" || client_id)` — computed on-the-fly at token issuance, not persisted
- **Schema**: `dedupKey` column (text, unique, indexed) on `identity_verifications`; `documentHash` loses unique constraint
- **Re-verification**: Same user re-verifying (dedup key matches own record) is allowed; same identity on different user is blocked

---

## What to build

Replace broken salt-randomized `documentHash` dedup with deterministic HMAC-based deduplication. Both OCR and NFC paths compute the same key, enabling cross-method dedup. Per-RP Sybil nullifier gives RPs one-identity-per-user enforcement without cross-RP linkability.

End-to-end: `DEDUP_HMAC_SECRET` env var → HMAC dedup key computation with canonical normalization → `dedupKey` column on `identity_verifications` → OCR `prepareDocument` integration → NFC `submitResult` integration → per-RP nullifier in OAuth tokens → `proof:sybil` scope → tests.

### Acceptance criteria

- [ ] `DEDUP_HMAC_SECRET` env var required (min 32 chars), validated in `env.ts`
- [ ] Dedup key is deterministic: same identity attributes → same key across sessions
- [ ] Dedup key canonical normalization: strips non-alphanumeric, uppercases document number
- [ ] OCR `prepareDocument` rejects when dedup key matches a different user's verified record
- [ ] NFC `submitResult` rejects when dedup key matches a different user's verified record (cross-method)
- [ ] Same user re-verifying (dedup key matches own record) is allowed
- [ ] `documentHash` unique constraint removed (kept as non-unique reference)
- [ ] Per-RP nullifier: same person + same RP = same nullifier
- [ ] Per-RP nullifier: same person + different RP = different nullifier
- [ ] Nullifier delivered as `sybil_nullifier` claim in OAuth tokens for verified users
- [ ] Nullifier absent for unverified users
- [ ] `proof:sybil` scope gates nullifier delivery
- [ ] Unit test: deterministic key generation, canonical normalization, nullifier derivation
- [ ] Integration test: OCR Sybil rejection, NFC cross-method rejection, re-verification allowed

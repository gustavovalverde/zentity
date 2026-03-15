# Task 08: FHE Integrity Binding

> Source: `security-hardening-malicious-server.md` Phase 2
> Priority: **P1** — FHE HMACs don't bind to user identity or attribute type, enabling cross-user attribute swaps
> Estimate: ~1 day

## Architectural decisions

- **Context-bound HMAC**: `HMAC-SHA256(BETTER_AUTH_SECRET, encodeAad(userId, attributeType, ciphertextBytes))` — uses existing `encodeAad` length-prefix encoding to prevent concatenation collisions
- **HMAC key**: Uses existing `BETTER_AUTH_SECRET` (per-user keys deferred)
- **Unique constraint**: `(userId, attributeType)` on `encrypted_attributes` table prevents duplicate rows

---

## What to build

Bind FHE ciphertext HMACs to user identity and attribute type, preventing a malicious server from swapping encrypted attributes between users or attribute types.

End-to-end: HMAC input change to include `(userId, attributeType)` → `encodeAad` integration → unique DB constraint on `(userId, attributeType)` → migration to recompute existing HMACs → tests.

### Acceptance criteria

- [ ] HMAC computation includes `(userId, attributeType)` in its input
- [ ] Same ciphertext with different userId produces different HMAC and fails verification
- [ ] Same ciphertext with different attributeType produces different HMAC and fails verification
- [ ] Unique constraint on `(userId, attributeType)` prevents duplicate rows
- [ ] Existing rows migrated with recomputed HMACs
- [ ] Unit test: context-bound HMAC verification (positive + cross-user + cross-attribute rejection)

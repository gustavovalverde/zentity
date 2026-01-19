---
status: "accepted"
date: "2026-01-12"
category: "technical"
domains: [privacy, security, platform]
builds-on: "[Passkey-first auth + PRF custody](0001-passkey-first-auth-prf-custody.md)"
---

# Adopt OPAQUE for password-based authentication

## Context and Problem Statement

Zentity needs a password option for users who cannot use passkeys, but storing password hashes or verifiers conflicts with our privacy model and increases breach risk. We also need a client-derived key that can wrap secret vault DEKs so that password users get the same key-custody guarantees as passkey users.

## Priorities & Constraints

- Keep raw passwords off the server and out of logs.
- Reduce breach impact if the database is compromised.
- Provide a client-derived export key for secret wrapping.
- Use a standardized, well-reviewed protocol that works in browsers.
- Keep performance acceptable for web clients.

## Decision Outcome

Chosen option: **OPAQUE (RFC 9807)** augmented PAKE via `@serenity-kit/opaque`, integrated into Better Auth and the sign-up flows.

Key elements of the decision:

- The server stores an **OPAQUE registration record** per user, not a password hash.
- The server holds a long-term **OPAQUE server setup** (`OPAQUE_SERVER_SETUP`).
- Clients verify the server’s static public key, pinned in production via `NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY` (fallback: `/api/auth/opaque-public-key`).
- The client derives an **export key** on registration/login and uses it to derive a KEK (HKDF) that wraps secret vault DEKs, mirroring the passkey PRF flow.

### Expected Consequences

- Server never receives or stores plaintext passwords.
- Database compromise alone does not enable offline password guessing; the server setup secret is also required.
- If the server setup secret is compromised, offline guessing becomes possible; Argon2 key stretching increases the cost per guess.
- OPAQUE is not post-quantum; if PQ requirements emerge, we must evaluate PQ PAKE alternatives or future OPAQUE ciphersuites.
- Rotating `OPAQUE_SERVER_SETUP` invalidates existing password registrations and requires a planned migration.
- Client bundles must be rebuilt when the pinned public key changes.

## Alternatives Considered

- Salted password hashes (Argon2/bcrypt) with conventional login.
- SRP or SPAKE2+ (other PAKEs without the same export-key integration or standardization fit).
- Passkey-only authentication (excludes users without passkey support).
- Magic-link-only authentication (email reliability and phishing tradeoffs).
- Wallet-only authentication via EIP-712 (now implemented as an additional option for Web3-native users).

## More Information

- Password model details: `docs/password-security.md`
- Cryptographic context: `docs/cryptographic-pillars.md`

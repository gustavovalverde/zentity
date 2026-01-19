# Password security

This repo includes password-based authentication using **OPAQUE** (augmented PAKE) via Better Auth, plus additional checks to reduce account takeover risk from credential stuffing.

## Goals

- **Block known-compromised passwords** (hard fail)
- **Keep requirements understandable** with live feedback
- **Minimize exposure** of password material during breach checks
- **Keep raw passwords off the server** during registration and login
- **Reduce breach impact** if the database is compromised
- **Prevent MITM on OPAQUE flows** via server public key pinning

Note: For users without passkey support, OPAQUE provides password-based authentication. For Web3-native users, **wallet-based authentication (EIP-712)** is also available as an alternative that requires no password at all—see [Cryptographic Pillars](cryptographic-pillars.md) for the wallet KEK derivation model.

## OPAQUE-based password authentication

OPAQUE is an **augmented PAKE**: the client never sends the raw password to the server, and the server stores a **registration record** instead of a password hash. During registration and login:

- The client generates an OPAQUE request from the password.
- The server replies with a challenge derived from `OPAQUE_SERVER_SETUP` (private server setup).
- The client finishes the flow locally, producing:
  - a **registration record** (stored server-side), and
  - an **export key** (used client-side to wrap secret vault keys).

To prevent man-in-the-middle attacks, the client verifies the server’s static public key. In production, we **pin** this key via `NEXT_PUBLIC_OPAQUE_SERVER_PUBLIC_KEY` (fallback: `/api/auth/opaque-public-key`).

### Breach impact model

- **DB compromise only**: attackers obtain registration records but **cannot validate password guesses offline** without the server setup secret.
- **DB + server setup compromise**: attackers can attempt offline guesses; Argon2 key stretching increases the cost of each guess.
- **Server logs** never contain plaintext passwords, because the server never receives them.
- **Post-quantum note**: current OPAQUE ciphersuites are not PQ; if PQ requirements arise we will evaluate alternative PAKEs or future OPAQUE suites.

All three auth methods (passkey, OPAQUE, wallet) provide equivalent key custody guarantees.

## Password policy summary

Authoritative (server-enforced via Better Auth):

- Length: 10–128 characters
- Breached password blocking (HIBP)

UX-only guidance (client):

- Avoid containing the user’s email
- Avoid containing the document number (when available in the flow)
- Recommended diversity: upper/lower/number/symbol (not enforced)

## What enforces the rules

OPAQUE handles the password exchange and keeps raw passwords off the server. We still run Better Auth’s HIBP checks for compromised-password blocking, and the UI performs a pre-check to reduce user frustration.

The server enforces breached-password blocking using Better Auth’s `haveIBeenPwned()` plugin. This runs during:

- Email + password sign-up
- Password reset
- Password change

If the password appears in known breaches, Better Auth rejects the request with:

- `code: PASSWORD_COMPROMISED`

This is the real security boundary. Client-side checks are UX helpers only and must never be relied on for enforcement.

Relevant code:

- `apps/web/src/lib/auth/auth.ts` (Better Auth config + plugin)
- `apps/web/src/lib/auth/better-auth-errors.ts` (shared error mapping for UX copy)
- `apps/web/src/lib/auth/password-policy.ts` (min/max + similarity checks)

## UX pre-check

To reduce frustration, the UI performs a **pre-check** after the user completes both password fields:

1. User types password + confirmation.
2. The parent triggers a check (via `breachCheckKey`, typically after confirmation blur when fields match).
3. The UI can **hold submission** while the check runs.
4. If compromised, the UI shows the warning and blocks the submit button.

Response contract:

- `{ compromised: true }` means the password appears in known breaches.
- `{ skipped: true }` means the check was not completed (invalid input or upstream error).

Relevant code:

- `apps/web/src/components/auth/password-requirements.tsx` (requirements UI + trigger model)
- `apps/web/src/lib/auth/password-pwned.ts` (client helper)
- `apps/web/src/app/api/password/pwned/route.ts` (HIBP range proxy)

## Privacy model for the pre-check

### What the browser sends

For the UX pre-check, the client **does not** send the plaintext password. It computes:

- `sha1(password)` (uppercase hex)

and sends only `{ sha1 }` to our Route Handler:

- `POST /api/password/pwned`

### What the server sends to HIBP

The Route Handler uses the Have I Been Pwned **range API** (k-anonymity):

- It sends only the first **5 characters** of the SHA‑1 hash prefix to HIBP.
- It never sends the plaintext password to HIBP.
- It uses the HIBP `Add-Padding` header to reduce response size leakage.

Relevant code:

- `apps/web/src/app/api/password/pwned/route.ts`

### What users can still see in DevTools

Users can always inspect what *their own browser* sends in the Network tab. The goal is not to hide requests from the user (impossible), but to ensure we are not transmitting or storing **plaintext passwords** for a UX-only check.

## Future improvements

- **Avoid duplicate upstream checks**: Better Auth will also run its own HIBP check on submit. We can add short-lived, non-identifying caching on the server-side Route Handler to reduce external calls without weakening enforcement.
- **Rate limiting**: Add per-IP / per-session limits to the pre-check endpoint to prevent abuse.
- **Passwordless**: Prefer passkeys, wallet auth, or magic links for stronger phishing resistance and less password exposure overall.
- **Key-stretching profiles**: make OPAQUE key stretching configurable per environment (with careful migration/compatibility planning).

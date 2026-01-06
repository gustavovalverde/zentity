# Password security

This repo includes password-based authentication (via Better Auth) and additional checks to reduce account takeover risk from credential stuffing.

## Goals

- **Block known-compromised passwords** (hard fail)
- **Keep requirements understandable** with live feedback
- **Minimize exposure** of password material during breach checks

## Password policy summary

Authoritative (server-enforced via Better Auth):

- Length: 10–128 characters
- Breached password blocking (HIBP)

UX-only guidance (client):

- Avoid containing the user’s email
- Avoid containing the document number (when available in the flow)
- Recommended diversity: upper/lower/number/symbol (not enforced)

## What enforces the rules

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
- **Passwordless**: Prefer passkeys or magic links for stronger phishing resistance and less password exposure overall.
- **PAKE/OPAQUE** (advanced): If we ever want a design where the server never sees the raw password during sign-up, we would need a different authentication protocol (not the current Better Auth email+password flow).

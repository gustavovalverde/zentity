# RFC-0010: Explicit User-Gesture Decryption + Passkey Prompts

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-04 |
| **Updated** | 2026-01-04 |
| **Author** | Gustavo Valverde |

## Summary

Require an explicit **user gesture** and **passkey prompt** for every profile
decrypt operation (no silent unlocks). This applies to passkey-sealed profile
data and any client-side secret decryption flows. Provide a short-lived,
opt-in "unlock for this session" mode for UX, but always require a user action
to initiate the unlock.

## Problem Statement

Today, some flows auto-attempt profile decryption on load (e.g., dashboard
auto-unlock). This weakens user trust because a decrypt can occur without a
clear, explicit action. It also blurs the guarantee that **the server cannot
access plaintext unless the user actively consents**. We need a strict
"user gesture required" policy for decryption.

## Goals

- Require **explicit user interaction** for every decrypt.
- Always show a **passkey prompt** (UV required) when decrypting.
- Make decryption **auditable** as a user-consented action.
- Keep a reasonable UX with an opt-in, short-lived "unlock for this session".

## Non-goals

- Defending against a malicious server that ships compromised JS.
- Eliminating all client-side caching (we will keep short-lived in-memory
  session unlock if the user opts in).
- Redesigning FHE verification (this RFC focuses on passkey-sealed data).

## Design Decisions

1. **No auto-unlock**
   - Remove any auto-decrypt on page load.
   - UI should show an explicit "Unlock with passkey" button.

2. **Passkey prompt for every decrypt**
   - WebAuthn PRF evaluation uses `userVerification: "required"`.
   - Decrypt calls are only triggered from a direct user gesture
     (click/tap/keyboard).

3. **Explicit session unlock (optional)**
   - After a successful decrypt, user can opt into a short-lived in-memory
     "unlock window" (e.g., 10–15 minutes).
   - The unlock window is **not persisted** (no localStorage/IndexedDB).

4. **Decryption guardrails**
   - Introduce a client-only guard that refuses to decrypt unless a
     `userGestureToken` is present.
   - Tokens are created only by UI event handlers and expire quickly.

5. **Telemetry**
   - Record a client metric event when a decrypt is performed:
     `client.passkey.decrypt` with `source=explicit_user_action`.

## Architecture Overview

### Decrypt Flow (Profile)

1. User clicks **Unlock with passkey**.
2. UI creates a short-lived `userGestureToken`.
3. `getStoredProfile()` verifies the token, then requests PRF output with
   user verification.
4. Decrypt happens in-browser; plaintext never leaves the device.
5. Optional: ask user if they want to "keep unlocked for X minutes".

## Implementation Plan

- **UI**
  - Remove auto-unlock useEffect from dashboard profile view.
  - Add explicit "Unlock with passkey" action + optional "unlock for session".

- **Crypto**
  - Update WebAuthn PRF calls to require user verification.
  - Add a `requireUserGesture()` guard to profile decrypt functions.

- **State**
  - Track `unlockUntil` in memory (React state or module cache).
  - Clear on navigation or tab refresh.

## Migration Strategy

- Ship as a backwards-compatible UX change.
- If a user tries to decrypt without gesture, show a prompt.

## Risks

- Slightly more friction for users who expect auto-unlock.
- Some platforms may not support PRF with UV required; we need good messaging.

## Testing Plan

- Unit tests:
  - Decrypt rejects without gesture token.
  - Decrypt succeeds with gesture token and PRF output.
- E2E:
  - Profile unlock requires a button click.
  - Session unlock expires after TTL.

## Open Questions

- Default TTL for session unlock (10 vs 15 minutes)?
- Should "unlock for session" be opt-in every time, or remember preference?

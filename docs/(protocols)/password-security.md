---
title: Password Security
description: OPAQUE protocol implementation and server-side password handling
---

Password authentication in Zentity uses OPAQUE, an augmented PAKE protocol that ensures the server never receives or stores the plaintext password. This document explains the protocol's security properties, the breach impact model, and the layered password policy. The axis of variation is where each defense operates: the protocol layer (OPAQUE), the policy layer (HIBP blocking), or the UX layer (client-side pre-checks). For users without passkey support, OPAQUE provides password-based authentication. For Web3-native users, wallet-based authentication (Sign-In with Ethereum) is available as an alternative that requires no password at all; see [Cryptographic Pillars](<../(concepts)/cryptographic-pillars.md>) for the wallet KEK derivation model.

## OPAQUE Protocol

OPAQUE is an augmented PAKE: the client never sends the raw password to the server, and the server stores a registration record instead of a password hash.

```mermaid
sequenceDiagram
    participant C as Client (Browser)
    participant S as Server

    Note over C,S: Registration
    C->>C: Generate OPAQUE request from password
    C->>S: Registration request
    S->>S: Process with OPAQUE_SERVER_SETUP
    S->>C: Registration response
    C->>C: Finalize locally
    C->>S: Store registration record + export key wraps vault keys

    Note over C,S: Authentication
    C->>C: Generate OPAQUE request from password
    C->>S: Login request
    S->>S: Derive challenge from stored record
    S->>C: Login response
    C->>C: Finalize locally, verify server public key
    C->>S: Login finish (session established)
    Note over C: Export key available for vault operations
```

During both registration and login, the client generates an OPAQUE request from the password. The server replies with a challenge derived from its private server setup. The client finishes the flow locally, producing a registration record (stored server-side) and an export key (used client-side to wrap secret vault keys).

To prevent man-in-the-middle attacks, the client verifies the server's static public key. In production, this key is pinned via a public configuration value, with a fallback to the OPAQUE public key endpoint.

---

The protocol ensures the password never reaches the server. The next section examines what an attacker gains under different compromise scenarios.

## Breach Impact Model

The security value of OPAQUE is most visible under breach scenarios. The three levels of compromise produce progressively worse outcomes, but even the worst case is significantly better than traditional password hashing.

- **DB compromise only**: Attackers obtain registration records but cannot validate password guesses offline without the server setup secret.
- **DB + server setup compromise**: Attackers can attempt offline guesses; Argon2 key stretching increases the cost of each guess.
- **Server logs**: Never contain plaintext passwords, because the server never receives them.

All three auth methods (passkey, OPAQUE, wallet) provide equivalent key custody guarantees. Current OPAQUE ciphersuites are not post-quantum; if PQ requirements arise, alternative PAKEs or future OPAQUE suites will be evaluated.

---

OPAQUE handles the password exchange. The next section describes the policy layer that guides users away from weak or compromised passwords.

## Password Policy

The policy operates at two layers with different enforcement boundaries. The server-enforced rules are the security boundary; the client-side checks are UX helpers that reduce friction.

### Server-Enforced (Authoritative)

- Length: 10 to 128 characters

The server never sees the password (OPAQUE), so it cannot check it against known breaches. Breached-password detection is client-side guidance only; see the breach check privacy model below.

### Client-Side (UX Guidance Only)

- Avoid containing the user's email
- Avoid containing the document number (when available in the flow)
- Recommended diversity: upper, lower, number, symbol (not enforced)

Client-side checks must never be relied on for enforcement.

---

Checking against HIBP requires care to avoid leaking the password. The next section explains the privacy model for this check.

## Breach Check Privacy Model

### UX Pre-Check

To reduce frustration, the UI performs a pre-check after the user completes both password fields. The check runs on blur when fields match, and the UI can hold submission while the check completes. If the password is compromised, the UI shows a warning and blocks the submit button.

### What the Browser Sends

The client does not send the plaintext password or the full hash. It computes SHA-1 of the password (uppercase hex) and sends only the first 5 characters, as `GET /api/password/pwned?prefix=XXXXX`. The route rejects anything that is not exactly 5 hex characters, so a full hash is refused. The request carries no cookies or flow identifiers, and the route does not log the prefix.

### What the Server Sends to HIBP

The route handler relays the Have I Been Pwned range API (k-anonymity): it sends the 5-character prefix to HIBP with the `Add-Padding` header and returns the `SUFFIX:COUNT` lines unchanged. The server never receives the suffix. The browser matches its own suffix locally and ignores padded entries with a count of 0. A lookup failure (invalid upstream response, timeout, rate limit) skips the check instead of blocking sign-up.

### DevTools Visibility

Users can inspect what their browser sends in the Network tab. The goal is not to hide requests from the user (impossible) but to ensure plaintext passwords are not transmitted or stored for a UX-only check.

## Future Improvements

- **Passwordless**: Prefer passkeys, wallet auth, or magic links for stronger phishing resistance and less password exposure.
- **Key-stretching profiles**: Make OPAQUE key stretching configurable per environment with careful migration planning.

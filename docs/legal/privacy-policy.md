# Privacy Policy

Last updated: March 2, 2026.

## 1. Who We Are

Zentity is a privacy-preserving identity verification platform. We design flows to minimize plaintext personal data exposure — raw documents and selfies are never stored, and identity attributes are protected by zero-knowledge proofs (ZKPs) and fully homomorphic encryption (FHE).

Contact: [hello@zentity.xyz](mailto:hello@zentity.xyz)

## 2. What Data We Collect

### Account Data

When you create an account, we collect and store:

- **Email address** — provided during sign-up
- **Display name** — chosen during sign-up
- **Authentication credentials** — passkey public keys, OPAQUE password verifiers, or wallet addresses (we never store raw passwords)

We do **not** collect or store profile pictures.

### Identity Verification Data

During identity verification:

- **Document images** (ID, passport) — processed by OCR, then discarded immediately. Never written to persistent storage
- **Selfie images** — used for liveness detection and face matching, then discarded immediately. Never written to persistent storage
- **Extracted PII** (name, date of birth, address, nationality, document number) — encrypted with your credential (passkey, password, or wallet) and stored as a **profile secret** that only you can decrypt. The server stores the ciphertext but cannot access the plaintext — only you can unlock it with your credential. This is the data you may choose to share with relying parties via OAuth consent (see Section 5)

What is also persistently stored:

- Cryptographic commitments (hashes of identity attributes)
- Zero-knowledge proofs (generated client-side in your browser)
- FHE ciphertexts (encrypted identity attributes that the server cannot decrypt)

### Technical Data

- IP address and browser type — used for security and abuse prevention
- Session cookies — for authentication (see Section 9)
- No tracking pixels, no third-party analytics

## 3. How We Use Your Data

- **Account authentication** — verifying your identity when you sign in
- **Identity verification** — processing documents and generating cryptographic proofs
- **Compliance** — enabling third-party relying parties to verify claims (e.g., age verified, document verified) via cryptographic proofs, or to receive specific identity attributes (e.g., name, date of birth) that you explicitly choose to share by unlocking your vault

We do **not** use your data for advertising, profiling, or retargeting.

We do **not** sell your data to third parties.

## 4. Social Sign-In Providers

Social sign-in (Google, GitHub) is available for **account linking only** — you must first create a Zentity account using a passkey, password, or wallet, then link a social provider from your account settings.

### Google

- We request only `openid` and `email` scopes — we do **not** request access to your name, profile picture, or any other Google data
- We receive your email address and email verification status
- We do not access any Google data beyond what is shown on the consent screen

### GitHub

- We receive your email address and GitHub username (required for the OAuth flow)
- We do not access your repositories, organizations, or any other GitHub data

### Token Storage

- OAuth access tokens and refresh tokens are encrypted at rest using XChaCha20-Poly1305
- We do not maintain ongoing API access to your Google or GitHub account

## 5. Data Sharing

- We do **not** sell personal data
- We do **not** share personal data with third parties for their own purposes
- **Service providers** — Railway (hosting), Vercel (landing page), and Turso (database) process data on our behalf as data processors
- **Relying parties** — when you explicitly consent to share data with a third-party application via OAuth, two types of sharing are available:
  - **Verification proofs** (`proof:*` scopes) — boolean flags indicating whether you passed specific checks (e.g., age verified, document verified). These contain **no personal information** and are derived from your verification record
  - **Identity attributes** (`identity.*` scopes) — actual personal information (name, date of birth, address, nationality, document details) from your encrypted vault. Sharing requires you to actively unlock your vault with your credential (passkey, password, or wallet). This data is delivered ephemerally — it is held in server memory for at most 5 minutes, consumed exactly once during the token exchange, and never stored in any database or consent record
  - In both cases, you select exactly which scopes to authorize on the consent screen. No data is shared without your explicit per-scope consent
- **Law enforcement** — only if legally compelled, and only to the extent required by law

## 6. Data Security

- All data in transit is encrypted via TLS
- Your profile secret (extracted identity attributes) is encrypted with your credential (passkey PRF, OPAQUE export key, or wallet signature) using AES-GCM — the server stores the ciphertext but **cannot** decrypt it
- Identity attributes used for compliance checks are encrypted using FHE (fully homomorphic encryption) — the server can compute on them without decrypting
- OAuth tokens are encrypted at rest with XChaCha20-Poly1305
- Document images and selfies are **never** persistently stored — they are processed in memory and discarded immediately
- Zero-knowledge proofs are generated entirely **client-side** in your browser — private inputs never leave your device during proving

## 7. Data Retention and Deletion

- Account data is retained while your account is active
- Upon account deletion, all associated data (cryptographic proofs, FHE ciphertexts, credentials, encrypted secrets) is permanently deleted
- Document images and selfies are discarded immediately after processing — they are never written to persistent storage
- You can delete your account at any time from your dashboard

## 8. Your Rights

- **Access** — request a copy of the data we hold about you
- **Deletion** — request permanent deletion of your account and all associated data
- **Portability** — export your cryptographic credentials
- **Unlink social accounts** — disconnect Google or GitHub from your account at any time from Settings
- **Revoke consent** — withdraw consent for specific relying party data sharing

Contact [hello@zentity.xyz](mailto:hello@zentity.xyz) for any data requests.

## 9. Cookies

- **Session cookies** — used for authentication; essential for the service to function
- No third-party tracking cookies
- No analytics cookies
- No advertising cookies

## 10. Changes to This Policy

We will update this page and the "Last updated" date when changes are made. Material changes will be communicated via email or in-app notice.

## 11. Contact

For privacy-related questions, data requests, or concerns:

- Email: [hello@zentity.xyz](mailto:hello@zentity.xyz)

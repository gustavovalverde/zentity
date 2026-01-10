# RFC-0014: FROST Social Recovery

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2025-01-06 |
| **Updated** | 2026-01-10 |
| **Author** | Gustavo Valverde |

## Summary

Enable account recovery via guardian threshold signatures using FROST (Flexible Round-Optimized Schnorr Threshold signatures). When a user loses their passkey, a threshold of trusted guardians (t-of-n) can collectively authorize recovery without any single guardian or the server being able to unilaterally access the user's encrypted secrets.

**Current implementation:**

- Guardian types implemented: **email** + **authenticator (TOTP/backup codes)**.
- Recovery can be initiated with **email or Recovery ID**.
- Email delivery uses **Resend in production** and **Mailpit locally**; otherwise manual approval links are shown.
- Recovery configs store both **group verifying key** and **public key package** for signer operations.
- Wallet and on-chain guardians remain future work.

This RFC supports a **four-tier guardian model**:

- **Tier 1 (Email)**: Approval link (implemented)
- **Tier 1.5 (Device)**: TOTP/backup codes via Better Auth 2FA (implemented)
- **Tier 2 (Wallet)**: SIWE (Sign-In with Ethereum) - future
- **Tier 3 (On-chain)**: GuardianRegistry contract - future

## Problem Statement

Currently, if a user loses all their passkeys, they have no way to recover their encrypted secrets (FHE keys, profile data). The passkey PRF-derived keys that wrap the DEK are unrecoverable. This creates a critical single point of failure for user data sovereignty.

**Requirements:**

- No single party (user, guardian, or server) can unilaterally recover
- Guardians should never see key material
- Async signing (no real-time coordination required)
- Support multiple guardian types with different security properties

## Onboarding Integration

Recovery setup is available from **Settings → Security**. Onboarding enforcement is planned but not enabled in the current implementation.

### Current Setup Flow

1. **Enable recovery** in settings (creates a FROST keyset via the signer service).
2. **Recovery ID** is generated and displayed (copy/download).
3. **Add guardian emails** (fills available guardian slots).
4. **Link authenticator guardian** (requires Better Auth 2FA enabled).
5. **Optional test**: start a recovery and confirm approvals.

Defaults: **2-of-3** threshold, `secp256k1` ciphersuite unless overridden.

### Planned Enforcement

- Prompt after passkey registration.
- Warning + optional grace period if skipped.
- Write restrictions after grace period (TBD).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Threshold scheme** | FROST (t-of-n) | RFC 9591 standard, NCC audited, supports async signing |
| **FROST library** | ZcashFoundation/frost (frost-secp256k1 + frost-ed25519) | Production-ready, supports secp256k1 + ed25519 ciphersuites |
| **Guardian model** | Four-tier (email, device, wallet, on-chain) | Balance accessibility with security; user choice |
| **Minimum threshold** | 2-of-3 enforced | Prevents single point of failure; balances security with practicality |
| **Maximum guardians** | 5 | Limits DKG complexity; covers enterprise needs |
| **Device guardian weight** | Full guardian (counts as 1) | Simplifies setup - user can do 2-of-3 with 1 device + 2 emails |
| **Key share storage** | Downloaded OR Server (passkey-wrapped) | Browser IndexedDB excluded as too fragile |
| **Recovery model** | FROST-authorized server-held wrapper | Server holds DEK wrapper; FROST signature authorizes release |
| **Device auth** | TOTP (RFC 6238) via `@better-auth/utils/otp` | User-controlled factor; reuses existing Better Auth utils |
| **Wallet auth** | SIWE (EIP-4361) | Industry standard; Better Auth plugin available |
| **On-chain registry** | GuardianRegistry contract | Enterprise auditability; ERC-4337 compatible |

### Security Levels

| Level | Requirements | Use Case |
|-------|-------------|----------|
| **Basic** | 2-of-3 email guardians | Consumer default |
| **Enhanced** | 2-of-3 where ≥1 device (hardware token) or wallet | Crypto users, self-sovereign |
| **High** | 3-of-5 where ≥2 wallet guardians | High-value accounts |
| **Maximum** | 3-of-5 where ≥1 on-chain guardian | Enterprise |

### Security Comparison

| Attack Vector | Email | Device | Wallet | On-chain |
|---------------|-------|--------|--------|----------|
| **SIM swap** | VULNERABLE | IMMUNE | IMMUNE | IMMUNE |
| **Email breach** | VULNERABLE | IMMUNE | IMMUNE | IMMUNE |
| **Phishing** | VULNERABLE | VULNERABLE | RESISTANT | RESISTANT |
| **Social engineering** | HIGH RISK | LOW RISK | MEDIUM RISK | LOW RISK |
| **Malware** | VULNERABLE | VULNERABLE | VULNERABLE | RESISTANT (HW) |
| **Key share theft** | Need passkey | Need TOTP | Need wallet | Need wallet |
| **Social coordination** | REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED |

## Architecture Overview

```text
                     FROST Social Recovery
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  User loses passkey → Guardians sign recovery challenge         │
│                       (t-of-n threshold)                        │
│                              ↓                                  │
│  Server validates FROST signature → Releases recovery DEK       │
│                              ↓                                  │
│  User registers new passkey → Re-wraps DEK with new PRF         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Trust Model

| Party | Can Do | Cannot Do |
|-------|--------|-----------|
| **User** | Initiate recovery, register new passkey | Recover without t guardians |
| **Guardian** | Sign recovery challenge | Access secrets, sign without verification |
| **Server** | Store wrapped DEK, validate signatures | Decrypt without FROST signature |
| **t-1 Guardians** | Nothing useful | Recover (need t signatures) |

## Guardian Tiers

Guardians do NOT need a full Zentity account (no identity verification required) - trust is social.

### Tier 1: Email Guardians

**Identity**: Email address | **Auth**: Tokenized approval link (no login) | **Storage**: None (approval-only)

```text
EMAIL GUARDIAN FLOW:

1. Receive email notification
2. Click approval link (no login required)
3. Confirm approval
4. Server records approval (tokenized, 15 min TTL)
5. Once threshold met, server triggers FROST signing with signer service
```

**Vulnerabilities**: SIM swap on email provider, phishing, email breach. Use short-lived links (15 min) and domain-bound verification tokens.
When email delivery is not configured (local dev), the recovery UI shows manual approval links for copy/share.

### Tier 1.5: Device Guardians

**Identity**: Better Auth 2FA device (TOTP secret) | **Auth**: 6-digit code or backup code | **Storage**: Better Auth 2FA tables (server-encrypted)

Device guardians are **user-controlled** and require no social coordination.

```text
DEVICE GUARDIAN FLOW:

1. User enters 6-digit code from authenticator
2. Server validates TOTP or backup code via Better Auth 2FA storage
3. Approval is recorded for the recovery challenge
4. Once threshold is met, the server triggers FROST signing with the signer service
```

| Device Type | Examples | Security |
|-------------|----------|----------|
| **Phone App** | Google Authenticator, Authy, 1Password | Lower (may be lost with phone) |
| **Hardware Token** | YubiKey OATH, Nitrokey | Higher (stored separately, offline option) |

**Implementation**: Uses Better Auth 2FA storage + `@better-auth/utils/otp` for RFC 6238 verification and consumes backup codes on use.

**Note**: TOTP is phishable in real-time. Use as ONE of t-of-n, not sole recovery factor.

### Tier 2: Wallet Guardians

**Identity**: Ethereum address | **Auth**: SIWE signature | **Storage**: Wallet-derived key OR passkey-wrapped

```text
WALLET GUARDIAN FLOW:

1. Receive notification (email/push - informational only)
2. Connect wallet to zentity.xyz
3. SIWE sign-in (wallet shows domain)
4. View recovery context
5. Sign approval message with wallet
6. Wallet signs FROST partial signature
7. Submit to server
```

**Benefits**: Immune to SIM swap/email breach, phishing-resistant (wallet displays domain), cryptographic proof of intent.

### Tier 3: On-chain Guardians

**Identity**: Ethereum address + on-chain commitment | **Auth**: Wallet signature verified against contract | **Storage**: Wallet-derived key

```text
ON-CHAIN GUARDIAN FLOW:

1. Guardian registers commitment: hash(FROST public share)
2. Commitment stored in GuardianRegistry contract
3. During recovery: guardian signs + contract verifies
4. Full auditability on-chain
```

**Benefits**: All wallet benefits + auditable on-chain record, ERC-4337 compatible, hardware wallet support.

### Key Share Storage Options

Current implementation: guardians do not store key shares; the signer service holds the shares and produces signatures after guardian approvals. The storage options below are future work for wallet/client-side guardians.

| Option | Encryption | Trade-offs |
|--------|------------|------------|
| **Downloaded** | AES-256-GCM + PBKDF2 (100k iterations) | Portable; guardian responsibility |
| **Server (passkey-wrapped)** | PRF-derived KEK (RFC-0001 pattern) | Multi-device; requires passkey |
| **Wallet-encrypted** | AES-256-GCM + wallet-derived key | No server storage; requires wallet |

## Guardian Management

### Removing a Guardian

Current implementation: removing a guardian deletes the entry only. DKG-based key rotation is planned for future hardening.

Planned flow (future):

1. User initiates removal from settings
2. Remaining guardians must re-sign to authorize removal
3. New DKG round generates fresh shares for remaining guardians
4. Old group public key rotated, new wrapped recovery DEK created
5. Removed guardian's share becomes cryptographically useless

**Minimum constraint**: Cannot remove guardian if it would drop below 2-of-3.

### Key Rotation

Triggered when:

- Guardian reports compromise
- Periodic rotation (optional, user-configured)
- Guardian removal

Rotation creates new FROST group key without changing underlying DEK.

## Database Schema

```sql
-- Recovery configuration per user
CREATE TABLE recovery_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  threshold INTEGER NOT NULL,
  total_guardians INTEGER NOT NULL,
  frost_group_pubkey TEXT NOT NULL,
  frost_public_key_package TEXT NOT NULL,
  frost_ciphersuite TEXT NOT NULL,      -- 'secp256k1' | 'ed25519'
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT
);

-- Recovery guardians
CREATE TABLE recovery_guardians (
  id TEXT PRIMARY KEY,
  recovery_config_id TEXT NOT NULL REFERENCES recovery_configs(id),
  email TEXT NOT NULL,
  participant_index INTEGER NOT NULL,
  guardian_type TEXT NOT NULL,          -- 'email' | 'twoFactor'
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT
);

-- Active recovery challenges
CREATE TABLE recovery_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  recovery_config_id TEXT NOT NULL REFERENCES recovery_configs(id),
  challenge_nonce TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  signatures_collected INTEGER DEFAULT 0,
  aggregated_signature TEXT,
  created_at TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

-- Guardian approval tokens
CREATE TABLE recovery_guardian_approvals (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES recovery_challenges(id),
  guardian_id TEXT NOT NULL REFERENCES recovery_guardians(id),
  token_hash TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT
);

-- Recovery ID (for email-less accounts)
CREATE TABLE recovery_identifiers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  recovery_id TEXT NOT NULL UNIQUE,
  created_at TEXT,
  updated_at TEXT
);

-- Recovery wrappers for secrets
CREATE TABLE recovery_secret_wrappers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  secret_id TEXT NOT NULL UNIQUE,
  wrapped_dek TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
```

## Sequence Diagrams

### Recovery Setup

```text
User                    Server               Signer Services
  │                        │                         │
  ├─ Enable recovery ─────►│                         │
  │                        ├─ DKG init ─────────────►│
  │                        │◄─ Group pubkey + package│
  │                        ├─ Store config + ID ────►│ DB
  │◄─ Recovery ID shown ───┤                         │
  │                        │                         │
  ├─ Add guardian email ──►│ (active immediately)    │
  ├─ Link 2FA guardian ───►│ (requires 2FA enabled)   │
```

### Recovery Flow

```text
User (lost passkey)      Server                 Guardian(s)
  │                        │                         │
  ├─ Start recovery ──────►│                         │
  │  (email or Recovery ID)│                         │
  │                        ├─ Create challenge ─────►│
  │                        ├─ Email approvals ──────►│
  │                        │                         │
  │                        │◄─ Approve link ─────────┤ (email guardian)
  │                        │◄─ Enter TOTP/backup ────┤ (authenticator guardian)
  │                        │                         │
  │                        ├─ Threshold met ────────►│ Signer services
  │                        │◄─ Aggregate signature ──┤
  │                        │                         │
  │◄─ Recovery approved ───┤                         │
  │                        │                         │
  ├─ Register new passkey ►│                         │
  │◄─ DEK released ────────┤                         │
  ├─ Re-wrap with new PRF ►│                         │
  │◄─ Account recovered ───┤                         │
  │                        ├─ Notify guardians ─────►│
```

## Re-verification Fallback

When all guardians are unavailable (e.g., user and guardians all lose access):

### Eligibility

- User proves email ownership (magic link)
- All guardian recovery attempts exhausted or expired
- 30-day cooling period from last recovery attempt

### Flow

1. **Identity Re-verification**: User re-submits identity documents + liveness check
2. **Signature Matching**: Server compares new signed claims against stored attestations
3. **Match Requirements**: **Exact match required** on:
   - Full name (from OCR)
   - Date of birth
   - Document number
   - Nationality
4. **If Match**: New FHE keys generated, new recovery setup required
5. **If Mismatch**: Recovery denied, manual support review

### Data Impact

| Data Type | After Re-verification |
|-----------|----------------------|
| Account | Preserved |
| Attestations/ZK Proofs | Preserved (signed, not encrypted) |
| FHE Keys | **New keys generated** |
| Encrypted Attributes | **Lost** (old DEK unrecoverable) |

### Security Rationale

Re-verification is intentionally difficult:

- Prevents social engineering attacks
- Maintains zero-knowledge property (server never holds plaintext keys)
- Ensures user understands data loss consequences

## Security Considerations

### Rate Limiting

**Current implementation**

- **Recovery challenge + approval token TTL**: 15 minutes

**Planned safeguards (not enforced yet)**

- Recovery attempts: 3 per 24 hours per user
- Guardian invitations: 10 per 24 hours per user
- Post-recovery cooldown: 7 days before new recovery attempt
- TOTP verification: 5 attempts per 15 minutes (1 hour lockout)

### Audit Logging

All recovery events are logged. Current implementation stores audit-relevant rows in `recovery_challenges` and `recovery_guardian_approvals`; richer audit trails remain future work.

- Guardian invitations (sent, accepted, expired)
- Recovery challenges (created, signed, completed, expired)
- Guardian signatures (committed, finalized)
- Notifications (sent, clicked/signed)
- Device guardian events (setup, TOTP used, backup code used)

### Key Share Security

| Storage | Protection |
|---------|------------|
| **Downloaded** | Password + file possession |
| **Server** | Passkey authentication |
| **Wallet** | Wallet signature required |
| **Device** | TOTP code + server encryption |

All transit: TLS 1.3 minimum. At rest: Only encrypted forms stored.

## Recovery Testing

Users should verify recovery works before they need it. This flow is planned but not yet implemented.

### Dry-Run Verification

Available in settings after setup complete:

1. User initiates "Test Recovery"
2. System creates test challenge (not real recovery)
3. One guardian receives test notification
4. Guardian signs (or user uses device guardian)
5. System verifies signature would aggregate correctly
6. Confirmation: "Recovery setup verified working"

Test does NOT:

- Trigger cooldown
- Notify all guardians
- Create audit trail (marked as test)
- Release actual DEK

**Recommended**: Test annually or after guardian changes.

## Cryptographic Architecture

### How FROST Unlocks PRF-Wrapped DEK

The recovery DEK is wrapped twice for defense-in-depth:

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     DUAL-WRAP ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FHE Keys (plaintext)                                               │
│       │                                                             │
│       ├── Wrapped by DEK ─────────────────────────────────────┐     │
│       │                                                       │     │
│       │   DEK                                                 │     │
│       │    │                                                  │     │
│       │    ├── Wrapped by PRF-KEK (passkey) ─── [normal use]  │     │
│       │    │   └── secret_wrappers.wrapped_dek               │     │
│       │    │                                                  │     │
│       │    └── Wrapped by FROST-KEK ─────────── [recovery]    │     │
│       │        └── recovery_secret_wrappers.wrapped_dek        │     │
│       │                                                       │     │
│       └── encrypted_secrets.encrypted_blob ───────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Recovery DEK Release Flow

1. **Setup**: When recovery is enabled, the client wraps the DEK with the recovery public key
2. **Storage**: `wrapped_dek` stored in `recovery_secret_wrappers`
3. **Recovery**: t guardian approvals trigger FROST aggregate signing via signer service
4. **Verification**: Server verifies signature against `frost_group_pubkey`
5. **Release**: If valid, server uses FROST signature to derive FROST-KEK
6. **Unwrap**: FROST-KEK unwraps DEK
7. **Re-wrap**: User's new passkey PRF wraps DEK, stored in `secret_wrappers`

### Key Insight

FROST signature doesn't directly contain DEK - it authorizes the server to perform unwrap operation. Server holds `recovery_secret_wrappers.wrapped_dek` but cannot unwrap without valid FROST signature.

## Implementation Files

### New Files

| Category | Files |
|----------|-------|
| **Database** | `apps/web/src/lib/db/schema/recovery.ts`, `apps/web/src/lib/db/queries/recovery.ts` |
| **Recovery keys** | `apps/web/src/lib/recovery/recovery-keys.ts`, `apps/web/src/lib/recovery/constants.ts` |
| **Signer integration** | `apps/web/src/lib/recovery/frost-service.ts` |
| **Email** | `apps/web/src/lib/email/recovery-mailer.ts`, `apps/web/src/lib/email/mailpit.ts`, `apps/web/src/lib/email/resend.ts` |
| **tRPC** | `apps/web/src/lib/trpc/routers/recovery.ts` |
| **UI (User)** | `apps/web/src/components/dashboard/recovery-setup-section.tsx`, `apps/web/src/app/(auth)/recover-social/page.tsx`, `apps/web/src/app/(auth)/recover-guardian/page.tsx`, `apps/web/src/app/(auth)/verify-2fa/*` |
| **Signer service** | `apps/signer/src/frost/*`, `apps/signer/src/routes/*`, `apps/signer/src/audit.rs` |

### Modified Files

- `apps/web/src/lib/db/schema/index.ts` - Export recovery schemas
- `apps/web/src/lib/trpc/routers/app.ts` - Mount recovery router
- `apps/web/src/lib/auth/auth.ts` - Enable Better Auth 2FA + recovery hooks
- `apps/web/src/components/dashboard/security-cards.tsx` - Surface 2FA in security UI
- `apps/web/src/lib/crypto/secret-vault.ts` - Store recovery wrappers when enabled

## References

### FROST Protocol

- [RFC 9591: Two-Round Threshold Schnorr Signatures with FROST](https://datatracker.ietf.org/doc/rfc9591/)
- [ZcashFoundation/frost](https://github.com/ZcashFoundation/frost)
- [The ZF FROST Book](https://frost.zfnd.org/)
- [NCC FROST Security Assessment](https://research.nccgroup.com/2023/10/23/public-report-zcash-frost-security-assessment/)

### Wallet-Based Social Recovery

- [Vitalik: Why we need wide adoption of social recovery wallets](https://vitalik.eth.limo/general/2021/01/11/recovery.html)
- [EIP-4361: Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361)
- [Better Auth SIWE Plugin](https://www.better-auth.com/docs/plugins/siwe)

### Security Research

- [SIM Swap Statistics 2025](https://deepstrike.io/blog/sim-swap-scam-statistics-2025)
- [AuthQuake: Microsoft MFA Vulnerability](https://workos.com/blog/authquake-microsofts-mfa-system-vulnerable-to-totp-brute-force-attack)

### Passkey Recovery Research

- [FIDO Credential Exchange Format (CXF)](https://fidoalliance.org/specifications-credential-exchange-specifications/) - Draft standard for passkey portability
- [Signal Secure Backups](https://signal.org/blog/introducing-secure-backups/) - 64-char recovery key model
- [ProtonMail Data Recovery](https://proton.me/blog/data-recovery-end-to-end-encryption) - Recovery phrase + file approach
- [Bitwarden PRF Implementation](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/) - WebAuthn PRF for vault encryption
- [Corbado: Passkeys & PRF](https://www.corbado.com/blog/passkeys-prf-webauthn) - PRF for E2E encryption
- [Authsignal: Passkey Recovery](https://www.authsignal.com/blog/articles/passkey-recovery-fallback) - Recovery patterns overview

### Internal References

- [RFC-0001: Passkey-Wrapped FHE Key Storage](0001-passkey-wrapped-fhe-keys.md)
- [RFC-0015: FROST Threshold Registrar](0015-frost-threshold-registrar.md)

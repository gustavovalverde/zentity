# RFC-0014: FROST Social Recovery

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2025-01-06 |
| **Updated** | 2025-01-06 |
| **Author** | Gustavo Valverde |

## Summary

Enable account recovery via guardian threshold signatures using FROST (Flexible Round-Optimized Schnorr Threshold signatures). When a user loses their passkey, a threshold of trusted guardians (t-of-n) can collectively authorize recovery without any single guardian or the server being able to unilaterally access the user's encrypted secrets.

This RFC supports a **four-tier guardian model**:

- **Tier 1 (Email)**: Magic link + passkey/password - mass adoption friendly
- **Tier 1.5 (Device)**: TOTP from authenticator app or hardware token - user-controlled, no social coordination
- **Tier 2 (Wallet)**: SIWE (Sign-In with Ethereum) - crypto-native users
- **Tier 3 (On-chain)**: GuardianRegistry contract - enterprise/institutional

## Problem Statement

Currently, if a user loses all their passkeys, they have no way to recover their encrypted secrets (FHE keys, profile data). The passkey PRF-derived keys that wrap the DEK are unrecoverable. This creates a critical single point of failure for user data sovereignty.

**Requirements:**

- No single party (user, guardian, or server) can unilaterally recover
- Guardians should never see key material
- Async signing (no real-time coordination required)
- Support multiple guardian types with different security properties

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Threshold scheme** | FROST (t-of-n) | RFC 9591 standard, NCC audited, supports async signing |
| **FROST library** | ZcashFoundation/frost (frost-secp256k1) | Production-ready, Ethereum-compatible curve, WASM compilable |
| **Guardian model** | Four-tier (email, device, wallet, on-chain) | Balance accessibility with security; user choice |
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

**Identity**: Email address | **Auth**: Magic link + passkey/password | **Storage**: Downloaded OR passkey-wrapped

```text
EMAIL GUARDIAN FLOW:

1. Receive email notification
2. Click magic link
3. Authenticate (passkey/password)
4. View recovery context
5. Click "Approve"
6. Browser generates FROST partial signature
7. Submit to server
```

**Vulnerabilities**: SIM swap on email provider, phishing, email breach. Use time-bound links (48h signing, 7d invite) and domain-bound verification tokens.

### Tier 1.5: Device Guardians (TOTP)

**Identity**: TOTP secret (server-encrypted) | **Auth**: 6-digit code or backup code | **Storage**: Server-custodied (TOTP gates access)

Device guardians are **user-controlled** and require no social coordination.

```text
DEVICE GUARDIAN FLOW:

1. User enters 6-digit code from authenticator
2. Server validates TOTP against stored secret
3. If valid: server generates FROST partial signature
4. Signature counts as 1 of t-of-n
```

| Device Type | Examples | Security |
|-------------|----------|----------|
| **Phone App** | Google Authenticator, Authy, 1Password | Lower (may be lost with phone) |
| **Hardware Token** | YubiKey OATH, Nitrokey | Higher (stored separately, offline option) |

**Implementation**: Uses `@better-auth/utils/otp` (RFC 6238 via Web Crypto):

```typescript
import { createOTP } from "@better-auth/utils/otp";

const totpURI = createOTP(secret, { digits: 6, period: 30 })
  .url("Zentity Recovery", userEmail);

const isValid = await createOTP(secret, { digits: 6, period: 30 })
  .verify(userCode, { window: 1 });
```

**Note**: TOTP is phishable in real-time. Use as ONE of t-of-n, not sole recovery factor.

### Tier 2: Wallet Guardians (SIWE)

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

| Option | Encryption | Trade-offs |
|--------|------------|------------|
| **Downloaded** | AES-256-GCM + PBKDF2 (100k iterations) | Portable; guardian responsibility |
| **Server (passkey-wrapped)** | PRF-derived KEK (RFC-0001 pattern) | Multi-device; requires passkey |
| **Wallet-encrypted** | AES-256-GCM + wallet-derived key | No server storage; requires wallet |

## Database Schema

```sql
-- Guardian accounts (email/wallet guardians only; device guardians stored in recovery_guardians)
CREATE TABLE guardian_accounts (
  id TEXT PRIMARY KEY,
  email TEXT,                           -- NULL for wallet-only
  email_verified_at TEXT,
  wallet_address TEXT,                  -- NULL for email-only
  guardian_type TEXT NOT NULL,          -- 'email' | 'wallet' | 'onchain'
  display_name TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Guardian passkey credentials (for server storage)
CREATE TABLE guardian_credentials (
  id TEXT PRIMARY KEY,
  guardian_account_id TEXT NOT NULL REFERENCES guardian_accounts(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER DEFAULT 0,
  transports TEXT,
  prf_salt TEXT,
  created_at TEXT
);

-- Recovery configuration per user
CREATE TABLE recovery_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  threshold INTEGER NOT NULL,
  total_guardians INTEGER NOT NULL,
  frost_group_pubkey TEXT NOT NULL,
  wrapped_recovery_dek TEXT NOT NULL,
  secret_id TEXT NOT NULL REFERENCES encrypted_secrets(id),
  security_level TEXT DEFAULT 'basic',
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT
);

-- Recovery guardians
CREATE TABLE recovery_guardians (
  id TEXT PRIMARY KEY,
  recovery_config_id TEXT NOT NULL REFERENCES recovery_configs(id),
  guardian_account_id TEXT REFERENCES guardian_accounts(id),
  participant_index INTEGER NOT NULL,
  guardian_type TEXT NOT NULL,          -- 'email' | 'device' | 'wallet' | 'onchain'
  public_key_share TEXT,
  encrypted_key_share TEXT,
  wallet_encrypted_share TEXT,
  key_share_storage TEXT,               -- 'downloaded' | 'server' | 'wallet'
  onchain_commitment TEXT,
  -- TOTP fields (device guardians)
  totp_secret_encrypted TEXT,
  totp_backup_codes_hash TEXT,
  totp_device_type TEXT,                -- 'phone_app' | 'hardware_token'
  totp_verified_at TEXT,
  totp_last_used_at TEXT,
  -- Invite fields
  status TEXT DEFAULT 'pending',
  invite_email TEXT,
  invite_wallet TEXT,
  invite_token_hash TEXT,
  invite_expires_at TEXT,
  activated_at TEXT
);

-- Active recovery challenges
CREATE TABLE recovery_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  recovery_config_id TEXT NOT NULL REFERENCES recovery_configs(id),
  challenge_nonce TEXT NOT NULL UNIQUE,
  user_email_verified_at TEXT,
  device_info TEXT,
  new_credential_id TEXT,
  status TEXT DEFAULT 'pending',
  signatures_collected INTEGER DEFAULT 0,
  aggregated_signature TEXT,
  created_at TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

-- Guardian signatures (FROST rounds)
CREATE TABLE recovery_signatures (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES recovery_challenges(id),
  guardian_id TEXT NOT NULL REFERENCES recovery_guardians(id),
  signing_commitment TEXT,
  partial_signature TEXT,
  guardian_email_verified_at TEXT,
  signer_ip TEXT,
  created_at TEXT,
  signed_at TEXT
);

-- Audit trail
CREATE TABLE guardian_notifications (
  id TEXT PRIMARY KEY,
  guardian_id TEXT NOT NULL REFERENCES recovery_guardians(id),
  challenge_id TEXT REFERENCES recovery_challenges(id),
  notification_type TEXT NOT NULL,
  email_sent_at TEXT,
  email_clicked_at TEXT,
  created_at TEXT
);
```

## Sequence Diagrams

### Guardian Invitation

```text
User                    Server                  Guardian
  │                        │                         │
  ├─ Add guardian ────────►│                         │
  │  (email/wallet)        │                         │
  │                        ├─ Send invite ──────────►│
  │                        │  (magic link, 7d exp)   │
  │                        │                         │
  │                        │◄─ Accept invite ────────┤
  │                        │   (verify identity)     │
  │                        │                         │
  │                        │◄─ Choose storage ───────┤
  │                        │                         │
  │                        ├─ DKG Round 1 ──────────►│
  │                        │◄─ DKG commitment ───────┤
  │                        │                         │
  │◄─ Collect commits ─────┤                         │
  │                        │                         │
  ├─ Finalize DKG ────────►│                         │
  │                        ├─ DKG Round 2 ──────────►│
  │                        │◄─ Key share stored ─────┤
  │                        │                         │
  │◄─ Guardian active ─────┤                         │
```

### Recovery Flow

```text
User (lost passkey)      Server                  Guardian(s)
  │                        │                         │
  ├─ Initiate recovery ───►│                         │
  │  (prove email via OTP) │                         │
  │                        ├─ Verify user ──────────►│
  │                        │                         │
  │                        ├─ Notify guardians ─────►│
  │                        │                         │
  │                        │◄─ Authenticate ─────────┤
  │                        │   (passkey/wallet/TOTP) │
  │                        │                         │
  │                        │◄─ View context ─────────┤
  │                        │◄─ Sign commitment ──────┤
  │                        │                         │
  │                        │  (repeat for t guardians)
  │                        │                         │
  │                        ├─ Aggregate signature ──►│
  │                        │                         │
  │◄─ Recovery approved ───┤                         │
  │                        │                         │
  ├─ Register new passkey ►│                         │
  │◄─ DEK released ────────┤                         │
  ├─ Re-wrap with new PRF ►│                         │
  │◄─ Account recovered ───┤                         │
  │                        ├─ Notify all guardians ─►│
```

## Security Considerations

### Rate Limiting

- **Recovery attempts**: 3 per 24 hours per user
- **Guardian invitations**: 10 per 24 hours per user
- **Signing window**: 48 hours from challenge creation
- **Post-recovery cooldown**: 7 days before new recovery attempt
- **TOTP verification**: 5 attempts per 15 minutes (1 hour lockout)

### Audit Logging

All recovery events are logged:

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

## Implementation Files

### New Files

| Category | Files |
|----------|-------|
| **Database** | `schema/recovery.ts`, `queries/recovery.ts`, `queries/guardian.ts` |
| **FROST** | `crypto/frost/types.ts`, `frost-wasm.ts`, `coordinator.ts`, `guardian-client.ts`, `key-share-storage.ts` |
| **TOTP** | `crypto/totp/totp.ts`, `backup-codes.ts` |
| **Contracts** | `contracts/guardian/GuardianRegistry.sol` |
| **tRPC** | `routers/recovery.ts`, `routers/guardian.ts`, `routers/device-guardian.ts` |
| **UI (User)** | `settings/recovery/page.tsx`, `recover-social/page.tsx`, `recovery/setup-wizard.tsx` |
| **UI (Guardian)** | `accept-invite/[token]/page.tsx`, `sign-recovery/[token]/page.tsx`, `guardian/storage-choice.tsx` |

### Modified Files

- `db/schema/index.ts` - Export recovery schemas
- `trpc/routers/app.ts` - Merge recovery routers
- `auth.ts` - Add SIWE plugin
- `recover-passkey/page.tsx` - Add social recovery option

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

### Internal References

- [RFC-0001: Passkey-Wrapped FHE Key Storage](0001-passkey-wrapped-fhe-keys.md)
- [RFC-0015: FROST Threshold Registrar](0015-frost-threshold-registrar.md)

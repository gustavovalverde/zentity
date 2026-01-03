# RFC-0001: Passkey-Wrapped FHE Key Storage

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2024-12-28 |
| **Updated** | 2025-12-30 |
| **Author** | Gustavo Valverde |

## Summary

Replace plaintext IndexedDB storage of FHE keys with passkey PRF envelope encryption (PRF-derived KEK wraps a random DEK), enabling zero-knowledge server storage, multi-device access, and scalable multi-passkey support.

## Problem Statement

Previously, FHE keys (client, public, server) were stored in plaintext IndexedDB. This approach had several issues:

- Keys are accessible to anyone with device access
- No user-key binding (keys exist independently of authentication)
- No multi-device support (each browser gets unique keys)

## Design Decisions

- **Fallback**: Require PRF support (no fallback - PRF-capable browsers only)
- **Multi-device**: Yes - server-stored encrypted keys, decrypted via PRF on each device
- **Multi-passkey**: Any registered passkey can decrypt (wrap the DEK for each new passkey)
- **UX**: Explicit onboarding step for "Secure your encryption keys"
- **User verification**: Required for all PRF evaluations (no UV-less PRF)
- **Create vs. get**: Treat PRF outputs during registration as opportunistic; always support PRF evaluation during assertions

## Library Selection

After evaluating available libraries, **native browser APIs are the recommended approach** for PRF implementation. Here's the analysis:

### WebAuthn PRF Layer

| Option | Decision | Rationale |
|--------|----------|-----------|
| **Native WebAuthn API** | ✅ Recommended | Full control over PRF extension, no abstraction leaks |
| SimpleWebAuthn | ⚠️ Not recommended | Has PRF support but intentionally minimal - maintainers warn it's a "footgun" for e2ee use |
| @github/webauthn-json | ❌ Deprecated | Deprecated in favor of browser-native types, will never support PRF |
| Better Auth passkeys | ❌ Not suitable | Uses SimpleWebAuthn internally but doesn't expose PRF extension |

**Why native APIs?** Yubico's PRF Developer Guide, Bitwarden, and wwWallet all recommend native WebAuthn APIs for PRF. The PRF extension requires precise control over the `extensions` object and `getClientExtensionResults()` - abstractions add risk without benefit.

**2025+ constraints to codify:**

- PRF outputs are fixed-length (32 bytes) and should be treated as high-entropy secrets.
- PRF outputs may be absent during credential creation; always support a follow-up `navigator.credentials.get()` to evaluate PRF during authentication.
- `evalByCredential` is the preferred path for multi-passkey envelopes (one assertion, multiple outputs).
- PRF is bound to user verification semantics; require `userVerification: "required"` for all PRF evaluation flows.

### Key Derivation Layer

| Option | Decision | Rationale |
|--------|----------|-----------|
| **WebCrypto HKDF** | ✅ Recommended | Native, secure, non-extractable keys, no dependencies |
| @noble/hashes HKDF | ✅ Fallback option | Already in dependency tree via Better Auth, useful for edge cases |
| Custom implementation | ❌ Never | Cryptographic footgun |

**Critical security requirements:**

- HKDF `info` parameter MUST include purpose binding (e.g., `"zentity-passkey-kek-v1"`)
- Output keys MUST be non-extractable CryptoKeys
- Salt can be empty (PRF output is already high-entropy)

### Symmetric Encryption Layer

| Option | Decision | Rationale |
|--------|----------|-----------|
| **WebCrypto AES-GCM** | ✅ Recommended | Native, hardware-accelerated, non-extractable keys |
| jose | ❌ Overkill | Already in deps but designed for JWE/JWT, not raw encryption |
| age-encryption | ❌ Overkill | Full file encryption library, unnecessary complexity |

### Dependency Summary

```text
Required (new):        None - using native APIs only
Optional (existing):   @noble/hashes (via better-auth) - for HKDF if WebCrypto unavailable
```

## Architecture Overview

### Layered Design (Separation of Concerns)

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  fhe-key-store.ts                                                  │
│  - Orchestrates FHE key lifecycle                                  │
│  - Generates keys via TFHE WASM                                    │
│  - Uses crypto layers for protection                               │
│  - Integrates with tRPC for server storage                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CRYPTO ABSTRACTION LAYER                        │
├─────────────────────────────────────────────────────────────────────┤
│  passkey-vault.ts (NEW - main entry point)                         │
│  - High-level API: storeSecret(), retrieveSecret()                 │
│  - Ties passkey auth to encrypted storage                          │
│  - Generic: works for any secret, not just FHE keys                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌───────────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│   webauthn-prf.ts     │ │ key-derivation  │ │ symmetric-crypto.ts │
│   (Native WebAuthn)   │ │ .ts (HKDF)      │ │ (AES-256-GCM)       │
├───────────────────────┤ ├─────────────────┤ ├─────────────────────┤
│ • checkPrfSupport()   │ │ • deriveKey()   │ │ • encrypt()         │
│ • createCredential…   │ │ • WebCrypto     │ │ • decrypt()         │
│ • evaluatePrf         │ │   HKDF (native) │ │ • Uses WebCrypto    │
│ • getPrfOutput()      │ │ • Purpose bind  │ │ • IV generation     │
└───────────────────────┘ └─────────────────┘ └─────────────────────┘
```

### Server-Side Storage (Envelope Encryption)

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Server (Next.js + SQLite)                   │
├─────────────────────────────────────────────────────────────────────┤
│  encrypted_secrets table (one row per secret type):                │
│  - id: TEXT PRIMARY KEY                                            │
│  - user_id: TEXT FK → users(id)                                    │
│  - secret_type: TEXT ('fhe_keys' | 'wallet_key' | ...)             │
│  - encrypted_blob: TEXT (DEK-encrypted ciphertext, base64 JSON)    │
│  - metadata: TEXT (JSON - e.g., FHE key_id)                        │
│  - version: TEXT                                                   │
│  - created_at, updated_at: TEXT                                    │
│                                                                     │
│  secret_wrappers table (one row per passkey):                      │
│  - id: TEXT PRIMARY KEY                                            │
│  - secret_id: TEXT FK → encrypted_secrets(id)                      │
│  - user_id: TEXT FK → users(id)                                    │
│  - credential_id: TEXT (passkey ID)                                │
│  - wrapped_dek: TEXT (KEK-wrapped DEK, base64 JSON)                │
│  - prf_salt: TEXT (salt used for PRF eval)                         │
│  - kek_version: TEXT                                               │
│  - created_at, updated_at: TEXT                                    │
│                                                                     │
│  → Server stores opaque ciphertext + wrappers, cannot decrypt      │
│  → Adding a passkey only adds a wrapper (no re-encrypt of secret)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Reusable primitives**: Each layer is independently testable and reusable
2. **Future-proof**: `passkey-vault.ts` + generic table allows protecting ANY client secret
3. **Clear boundaries**: WebAuthn, crypto, and application logic are cleanly separated
4. **Better Auth compatible**: Works alongside BA without modification

## Key Cryptographic Flow

### Registration (Passkey + FHE Keys)

1. User creates account via Better Auth
2. User registers passkey with **PRF extension enabled**
3. Client generates fresh FHE keys (TFHE-rs WASM)
4. Client generates a random **DEK** (data encryption key)
5. Client encrypts FHE keys with DEK: `AES-256-GCM(DEK, iv, payload)`
6. Client derives a **KEK** from PRF output: `HKDF(PRF_output, "zentity-passkey-kek-v1")`
7. Client wraps DEK with KEK: `AES-256-GCM(KEK, iv, DEK)`
8. Client sends `encrypted_blob + wrapped_dek + prf_salt + credential_id` to server
9. Server stores ciphertext in `encrypted_secrets` and wrapper in `secret_wrappers`

### Authentication (Key Recovery on Any Device)

1. User authenticates with passkey + PRF (native WebAuthn). PRF evaluation happens during the assertion flow.
2. Server returns `encrypted_blob` + matching `secret_wrapper`
3. Client derives KEK from PRF output (same salt as wrapper)
4. Client unwraps DEK, then decrypts FHE keys locally
5. Keys stay in memory only for active session

### PRF Browser Compatibility Check

```typescript
// At passkey registration, check PRF support
const capabilities = await PublicKeyCredential.getClientCapabilities?.();
const supported =
  capabilities?.["extension:prf"] === true ||
  (Array.isArray(capabilities?.extensions) &&
    capabilities?.extensions.includes("prf")) ||
  capabilities?.prf === true;
// Also verify PRF output via getClientExtensionResults() during create/get
```

If PRF not supported → show error message, require different browser.

If PRF output is not returned during credential creation, immediately prompt the user for a PRF-enabled assertion (same passkey) and continue the flow using that output.

## Implementation Steps

### Step 1: Foundation Layer - Symmetric Crypto (`src/lib/crypto/symmetric-crypto.ts`)

Pure encryption/decryption using WebCrypto:

```typescript
export interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * Generate a cryptographically secure 12-byte IV for AES-GCM.
 * AES-GCM requires a unique IV per encryption with the same key.
 */
export function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param key - Non-extractable CryptoKey from key derivation
 * @param plaintext - Data to encrypt
 * @returns Ciphertext with IV for storage
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<EncryptedBlob> {
  const iv = generateIv();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 *
 * @throws DOMException if decryption fails (wrong key or tampered data)
 */
export async function decrypt(
  key: CryptoKey,
  blob: EncryptedBlob
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.iv },
    key,
    blob.ciphertext
  );
  return new Uint8Array(plaintext);
}
```

- AES-256-GCM with 12-byte IV (NIST recommended)
- No dependencies beyond WebCrypto API
- Keys must be non-extractable (enforced by key derivation layer)

### Step 2: Foundation Layer - Key Derivation (`src/lib/crypto/key-derivation.ts`)

HKDF-based key derivation using WebCrypto:

```typescript
/**
 * Purpose-binding info strings for HKDF.
 * CRITICAL: Different purposes MUST use different info strings
 * to ensure keys derived for one purpose cannot be used for another.
 */
export const HKDF_INFO = {
  PASSKEY_KEK: 'zentity-passkey-kek-v1',
} as const;

/**
 * Generate a random salt for PRF evaluation.
 * 32 bytes provides 256 bits of entropy.
 */
export function generatePrfSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive an AES-256 encryption key from PRF output using HKDF.
 *
 * SECURITY NOTES:
 * - The `info` parameter provides domain separation (purpose binding)
 * - Output key is non-extractable - cannot be exported from WebCrypto
 * - Salt is optional when IKM is already high-entropy (PRF output is)
 *
 * @param prfOutput - Raw PRF output from WebAuthn (32 bytes)
 * @param info - Purpose-binding string (MUST be unique per use case)
 * @returns Non-extractable AES-256-GCM CryptoKey
 */
export async function deriveKekFromPrf(
  prfOutput: Uint8Array,
  info: string = HKDF_INFO.PASSKEY_KEK
): Promise<CryptoKey> {
  // Import PRF output as HKDF key material
  const masterKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false, // non-extractable
    ['deriveKey']
  );

  // Derive AES-256-GCM KEK with purpose binding
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new Uint8Array(0), // Empty salt - PRF output already high-entropy
      hash: 'SHA-256',
      info: new TextEncoder().encode(info),
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable - CRITICAL for security
    ['encrypt', 'decrypt']
  );
}
```

- Uses native WebCrypto HKDF (no external dependencies)
- `@noble/hashes` available as fallback if needed (via Better Auth dependency tree)
- **Non-extractable keys** prevent key material from being exposed to JavaScript
- **Purpose binding** via `info` parameter prevents cross-protocol attacks

### Step 3: Foundation Layer - WebAuthn PRF (`src/lib/crypto/webauthn-prf.ts`)

Pure WebAuthn PRF extension handling using native browser APIs:

```typescript
export interface PrfSupportStatus {
  supported: boolean;
  reason?: string;
}

export async function checkPrfSupport(): Promise<PrfSupportStatus> {
  if (!window.PublicKeyCredential) {
    return { supported: false, reason: "WebAuthn is not available." };
  }

  const caps = await PublicKeyCredential.getClientCapabilities?.();
  const supported =
    caps?.["extension:prf"] === true ||
    (Array.isArray(caps?.extensions) && caps.extensions.includes("prf")) ||
    caps?.prf === true;

  return supported
    ? { supported: true }
    : { supported: false, reason: "PRF extension not supported." };
}

export async function createCredentialWithPrf(
  options: PublicKeyCredentialCreationOptions
): Promise<{
  credentialId: string;
  prfEnabled: boolean;
  prfOutput: Uint8Array | null;
}> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      extensions: { ...options.extensions, prf: options.extensions?.prf ?? {} },
    },
  })) as PublicKeyCredential;

  const extensionResults = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  return {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    prfEnabled: extensionResults.prf?.enabled === true,
    prfOutput: extensionResults.prf?.results?.first
      ? new Uint8Array(extensionResults.prf.results.first)
      : null,
  };
}

export async function evaluatePrf(params: {
  credentialIdToSalt: Record<string, Uint8Array>;
}): Promise<{
  assertion: PublicKeyCredential;
  prfOutputs: Map<string, Uint8Array>;
  selectedCredentialId: string;
}> {
  // Uses extensions.prf.eval or extensions.prf.evalByCredential
}
```

- No Better Auth coupling - works alongside existing passkey auth
- Uses native WebAuthn API for full control over PRF extension
- Returns raw 32-byte PRF output for key derivation
- Salt must be stored and reused to derive the same key later
- Some authenticators only return PRF output during `navigator.credentials.get`

### Step 4: Abstraction Layer - Passkey Vault (`src/lib/crypto/passkey-vault.ts`)

High-level API combining layers 1-3:

```typescript
export async function createSecretEnvelope(params: {
  secretType: string;
  plaintext: Uint8Array;
  prfOutput: Uint8Array;
  credentialId: string;
  prfSalt: Uint8Array;
  secretId?: string;
}): Promise<{
  secretId: string;
  encryptedBlob: string;
  wrappedDek: string;
  prfSalt: string;
}>;

export async function decryptSecretEnvelope(params: {
  secretId: string;
  secretType: string;
  encryptedBlob: string;
  wrappedDek: string;
  credentialId: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array>;

export async function wrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  dek: Uint8Array;
  prfOutput: Uint8Array;
}): Promise<string>;

export async function unwrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  wrappedDek: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array>;
```

- Generic secret protection - not FHE-specific
- Uses envelope encryption (random DEK + PRF-derived KEK wrapper)
- Binds AAD to secretId + secretType for ciphertext, and secretId + credentialId for wrapper
- Supports per-passkey wrappers for rotation/add/remove

### Step 5: Database Schema (Drizzle + SQLite)

```sql
CREATE TABLE encrypted_secrets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  secret_type TEXT NOT NULL,        -- 'fhe_keys', 'wallet_key', etc.
  encrypted_blob TEXT NOT NULL,     -- base64 JSON ciphertext (DEK-encrypted)
  metadata TEXT,                    -- JSON for type-specific data
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, secret_type)
);

CREATE TABLE secret_wrappers (
  id TEXT PRIMARY KEY,
  secret_id TEXT NOT NULL REFERENCES encrypted_secrets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,        -- base64 JSON (KEK-wrapped DEK)
  prf_salt TEXT NOT NULL,           -- base64 PRF salt for this credential
  kek_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(secret_id, credential_id)
);

-- Onboarding: add a keys_secured flag to gate Step 5 completion
ALTER TABLE onboarding_sessions ADD COLUMN keys_secured INTEGER DEFAULT false NOT NULL;
```

### Step 6: tRPC Router (`src/lib/trpc/routers/secrets.ts`)

New router for encrypted secrets:

```typescript
// Protected procedures (require auth)
getPasskeyUser: Return userId/email/displayName for WebAuthn options
getSecretBundle: Return { secret, wrappers } for a secretType
storeSecret: Upsert encrypted_blob + wrapper (wrapped_dek/prf_salt)
addWrapper: Add a new passkey wrapper for an existing secret
updateSecretMetadata: Merge secret metadata (e.g., FHE key_id)
```

### Step 7: Application Layer - FHE Key Store (`src/lib/crypto/fhe-key-store.ts`)

Refactor to use passkey-vault:

```typescript
export async function storeFheKeys(params: {
  keys: StoredFheKeys;
  enrollment: PasskeyEnrollmentContext;
}): Promise<{ secretId: string }>;

export async function getStoredFheKeys(): Promise<StoredFheKeys | null>;

export async function persistFheKeyId(keyId: string): Promise<void>;
```

- Generates FHE keys via TFHE WASM
- Delegates encryption to passkey-vault
- Handles FHE-specific metadata (key_id)
- Caches decrypted keys in-memory (short TTL)
- Passkey rotation is handled via `addWrapper` when account settings UI is added

### Step 8: Onboarding Step (`src/components/onboarding/steps/step-secure-keys.tsx`)

New explicit step:

- PRF browser compatibility check with clear messaging
- Educational explanation of passkey-protected encryption
- Passkey registration with PRF extension enabled
- FHE key generation + encryption on success
- Success confirmation before proceeding

## Auth Flow Integration (2026+ ready)

To minimize ceremonies, the passkey assertion used for login can also evaluate PRF:

1. Client initiates passkey sign-in (`navigator.credentials.get`) with `extensions.prf.evalByCredential`.
2. Server verifies the WebAuthn assertion as usual.
3. Client derives KEK from the PRF output and unlocks FHE keys locally.
4. No PRF outputs are sent to the server; only encrypted bundles are stored server-side.

This keeps authentication and key-unlock in a single gesture and lets future flows reuse the same passkey credential for both login and key recovery.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/crypto/symmetric-crypto.ts` | Create | AES-256-GCM encryption primitives |
| `src/lib/crypto/key-derivation.ts` | Create | HKDF key derivation |
| `src/lib/crypto/webauthn-prf.ts` | Create | WebAuthn PRF extension handling |
| `src/lib/crypto/passkey-vault.ts` | Create | High-level secret protection API |
| `src/lib/crypto/fhe-key-store.ts` | Rewrite | Use passkey-vault, remove IndexedDB |
| `src/lib/crypto/tfhe-browser.ts` | Simplify | Only key generation, no persistence |
| `src/lib/utils/base64url.ts` | Create | Base64url helpers for WebAuthn IDs |
| `src/types/webauthn-prf.d.ts` | Create | WebAuthn PRF type augmentation |
| `src/lib/db/schema/crypto.ts` | Modify | Add encrypted_secrets + secret_wrappers tables |
| `src/lib/db/schema/onboarding.ts` | Modify | Add keys_secured flag |
| `src/lib/db/queries/crypto.ts` | Modify | Encrypted secret + wrapper queries |
| `src/lib/db/queries/onboarding.ts` | Modify | Persist keys_secured updates |
| `src/lib/trpc/routers/secrets.ts` | Create | tRPC router for encrypted secrets |
| `src/components/onboarding/steps/step-secure-keys.tsx` | Create | New onboarding step |
| `src/lib/crypto/__tests__/*.test.ts` | Create | Tests for each layer |

## Security Considerations

1. **Zero-knowledge preserved**: Server stores only encrypted blob, cannot derive key
2. **Hardware-backed**: PRF secret derived in authenticator's secure element
3. **No fallback**: Maintains security guarantee, accepts reduced browser compatibility
4. **Salt uniqueness**: Fresh random salt per encryption prevents rainbow attacks
5. **Key rotation**: Adding a passkey only adds a wrapper; removing a passkey deletes its wrapper (DEK stays encrypted)

## Browser Support

PRF support is a three-way intersection of **browser + OS + authenticator**. Rely on
runtime checks and avoid hard-coding version gates.

| Platform | Browser(s) | Platform passkey PRF | Roaming security key PRF | Notes |
|---------|------------|----------------------|--------------------------|-------|
| Windows 11 | Chrome / Edge / Firefox | ❌ | ✅ | Windows Hello lacks `hmac-secret` support |
| macOS 15+ | Safari 18+, Chrome | ✅ (iCloud Keychain) | Chrome: ✅ / Safari: ❌ | Safari does not pass PRF to roaming keys |
| iOS / iPadOS 18+ | Safari 18+ | ✅ (iCloud Keychain) | ❌ | Extensions not passed to roaming keys |
| Android | Chrome | ✅ (Google Password Manager) | USB: ✅ / NFC: ❌ | NFC keys currently unsupported |

### Platform-Specific Limitations

**Apple devices:** PRF works with **iCloud Keychain** passkeys, but iOS/iPadOS
Safari does not pass extension data to roaming keys, and macOS Safari does not
support PRF with roaming keys. Chrome on macOS does.

**Detection Strategy:**

```typescript
// Prefer capability checks, then verify PRF output at create/get time.
const { credentialId, prfOutput } = await createCredentialWithPrf(options);
const output =
  prfOutput ??
  (await evaluatePrf({
    credentialIdToSalt: { [credentialId]: prfSalt },
  })).prfOutputs.get(credentialId);

if (!output) {
  // Authenticator didn't return PRF output - show upgrade message
}
```

For unsupported configurations, show:

> "Zentity requires passkey PRF support to protect your encryption keys.
>
> **Supported:**
>
> - Chrome / Edge / Firefox with a PRF-capable passkey
> - Safari 18+ with iCloud Keychain passkeys
>
> **Not supported:**
>
> - External security keys on iOS/iPadOS Safari
> - Windows Hello (no PRF support)
> - macOS Safari with roaming keys
>
> If using a security key on Apple devices, please switch to iCloud Keychain or use Chrome/Firefox."

## Technical Notes

### Library Integration

- **Better Auth**: Does NOT support PRF natively. Our PRF module runs alongside BA without modification. Future upstream PR possible after implementation stabilizes.
- **SimpleWebAuthn**: Better Auth uses this internally, but we bypass it for PRF operations. SimpleWebAuthn intentionally keeps PRF support minimal and warns against using it for e2ee.
- **Dependencies**: No new dependencies required. Uses native WebCrypto + WebAuthn APIs. `@noble/hashes` available via Better Auth if HKDF fallback needed.

### Future Authentication Integration

- **Single prompt unlock**: Use the same `navigator.credentials.get()` call during login to both verify the WebAuthn assertion and evaluate PRF, so authentication and key unlock happen together.
- **Shared credential identity**: Store the `credential_id` from `secret_wrappers` alongside the auth credential (public key, signCount), so a single passkey can serve both auth + encryption.
- **Server registration**: When Better Auth adds PRF extension exposure, register the passkey with PRF enabled via its server flow, but keep PRF evaluation client-side for KEK derivation.

### Security Implementation Details

**HKDF Purpose Binding (Critical):**

```typescript
// CORRECT: Purpose-specific info parameter
info: new TextEncoder().encode('zentity-passkey-kek-v1')

// WRONG: No purpose binding - allows cross-protocol attacks
info: new Uint8Array(0)
```

**Non-Extractable Keys (Critical):**

```typescript
// CORRECT: Key material cannot be exported
extractable: false

// WRONG: Key material can be read by JavaScript
extractable: true  // Never do this
```

**Salt Handling:**

- PRF salt stored alongside each wrapper on the server
- Fresh salt per secret (different FHE keys = different salts)
- Same salt + same passkey = same PRF output = same derived key

### Testing Strategy

1. **Unit tests**: Each layer independently (symmetric-crypto, key-derivation, webauthn-prf)
2. **Integration tests**: passkey-vault with mocked WebAuthn
3. **E2E tests**: Full flow with real passkeys (Chrome only, requires user interaction)
4. **Security tests**: Verify non-extractable keys, purpose binding, salt uniqueness

## References

- [WebAuthn PRF Extension - W3C Wiki](https://github.com/w3c/webauthn/wiki/Explainer:-PRF-extension)
- [Bitwarden PRF Implementation](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/)
- [Yubico PRF Developer Guide](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html)
- [Corbado PRF for E2E Encryption](https://www.corbado.com/blog/passkeys-prf-webauthn)
- [SimpleWebAuthn PRF Support](https://simplewebauthn.dev/docs/packages/browser#authentication) - Library reference (we use native APIs instead)
- [MDN: WebAuthn Extensions (PRF)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)
- [MDN: PublicKeyCredentialCreationOptions](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions)
- [MDN: PublicKeyCredentialRequestOptions](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions)
- [WebAuthn Level 3 Spec (PRF extension)](https://w3c.github.io/webauthn/#prf-extension)
- [Firefox 124 Release Notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/124) - PRF extension support added
- [wwWallet Keystore Design](https://github.com/nickreynolds/nickreynolds.github.io/blob/main/prfkeystore.md) - Prior art for PRF-based key wrapping

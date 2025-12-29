# RFC-0001: Passkey-Wrapped FHE Key Storage

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-12-28 |
| **Author** | Gustavo Valverde |

## Summary

Replace plaintext IndexedDB storage of FHE keys with WebAuthn PRF-wrapped encryption, enabling zero-knowledge server storage and multi-device support.

## Problem Statement

Currently, FHE keys (client, public, server) are stored in plaintext IndexedDB. This approach has several issues:

- Keys are accessible to anyone with device access
- No user-key binding (keys exist independently of authentication)
- No multi-device support (each browser gets unique keys)

## Design Decisions

- **Fallback**: Require PRF support (no fallback - PRF-capable browsers only)
- **Multi-device**: Yes - server-stored encrypted keys, decrypted via PRF on each device
- **Multi-passkey**: Any registered passkey can decrypt (re-encrypt with each new passkey)
- **UX**: Explicit onboarding step for "Secure your encryption keys"

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

### Key Derivation Layer

| Option | Decision | Rationale |
|--------|----------|-----------|
| **WebCrypto HKDF** | ✅ Recommended | Native, secure, non-extractable keys, no dependencies |
| @noble/hashes HKDF | ✅ Fallback option | Already in dependency tree via Better Auth, useful for edge cases |
| Custom implementation | ❌ Never | Cryptographic footgun |

**Critical security requirements:**

- HKDF `info` parameter MUST include purpose binding (e.g., `"zentity-fhe-wrap-v1"`)
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
│ • createWithPrf()     │ │ • WebCrypto     │ │ • decrypt()         │
│ • authenticateWithPrf │ │   HKDF (native) │ │ • Uses WebCrypto    │
│ • getPrfOutput()      │ │ • Purpose bind  │ │ • IV generation     │
└───────────────────────┘ └─────────────────┘ └─────────────────────┘
```

### Server-Side Storage

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Server (Next.js + SQLite)                   │
├─────────────────────────────────────────────────────────────────────┤
│  encrypted_secrets table (generic, not FHE-specific):              │
│  - id: TEXT PRIMARY KEY                                            │
│  - user_id: TEXT FK → users(id)                                    │
│  - credential_id: TEXT (passkey that encrypted this)               │
│  - secret_type: TEXT ('fhe_keys' | 'wallet_key' | ...)             │
│  - encrypted_blob: TEXT (base64 ciphertext)                        │
│  - salt: TEXT (PRF salt)                                           │
│  - metadata: TEXT (JSON - e.g., FHE key_id)                        │
│  - created_at, updated_at: TEXT                                    │
│  UNIQUE(user_id, credential_id, secret_type)                       │
│                                                                     │
│  → Server stores opaque ciphertext, CANNOT decrypt                 │
│  → Generic design allows future secret types (wallet keys, etc.)   │
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
4. Client derives wrapping key: `HKDF(PRF_output, salt, "zentity-fhe-wrap", 64)`
5. Client encrypts FHE keys: `AES-256-GCM(key, iv, clientKey || publicKey || serverKey)`
6. Client sends encrypted blob + salt + credential_id to server
7. Server stores in `encrypted_secrets` table linked to user

### Authentication (Key Recovery on Any Device)

1. User authenticates with passkey (Better Auth + PRF extension)
2. Server returns user's encrypted FHE key blob + salt
3. Client derives same wrapping key: `HKDF(PRF_output, salt, "zentity-fhe-wrap", 64)`
4. Client decrypts FHE keys locally
5. Keys available in memory for FHE operations

### PRF Browser Compatibility Check

```typescript
// At passkey registration, check PRF support
const supported = await PublicKeyCredential.isConditionalMediationAvailable?.();
// Also check extensions support during credential creation
```

If PRF not supported → show error message, require different browser.

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
  FHE_WRAP: 'zentity-fhe-wrap-v1',
  WALLET_WRAP: 'zentity-wallet-wrap-v1',
} as const;

/**
 * Generate a random salt for PRF evaluation.
 * 32 bytes provides 256 bits of entropy.
 */
export function generateSalt(): Uint8Array {
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
export async function deriveEncryptionKey(
  prfOutput: Uint8Array,
  info: string = HKDF_INFO.FHE_WRAP
): Promise<CryptoKey> {
  // Import PRF output as HKDF key material
  const masterKey = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false, // non-extractable
    ['deriveKey']
  );

  // Derive AES-256-GCM key with purpose binding
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
export interface PrfResult {
  credential: PublicKeyCredential;
  prfOutput: Uint8Array | null;
}

/**
 * Check if browser and authenticator support PRF extension.
 * Must be called before attempting PRF operations.
 */
export async function checkPrfSupport(): Promise<boolean> {
  // Check if WebAuthn is available
  if (!window.PublicKeyCredential) return false;

  // Check for conditional mediation (indicates modern WebAuthn support)
  const conditionalSupported =
    await PublicKeyCredential.isConditionalMediationAvailable?.();

  // PRF requires Chrome 116+, Firefox 124+, Safari 18+
  // Actual PRF support is verified during credential creation/authentication
  return conditionalSupported === true;
}

/**
 * Register a new passkey with PRF extension enabled.
 *
 * IMPORTANT: PRF support is indicated via clientExtensionResults.prf.enabled
 * after registration. If not enabled, the authenticator doesn't support PRF.
 *
 * @param options - WebAuthn credential creation options
 * @returns Credential with PRF enabled status
 */
export async function createCredentialWithPrf(
  options: PublicKeyCredentialCreationOptions
): Promise<{ credential: PublicKeyCredential; prfEnabled: boolean }> {
  // Augment options with PRF extension
  const prfOptions: PublicKeyCredentialCreationOptions = {
    ...options,
    extensions: {
      ...options.extensions,
      // Request PRF support during registration
      prf: {},
    },
  };

  const credential = (await navigator.credentials.create({
    publicKey: prfOptions,
  })) as PublicKeyCredential;

  // Check if authenticator supports PRF
  const extensionResults = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  const prfEnabled = extensionResults.prf?.enabled === true;

  return { credential, prfEnabled };
}

/**
 * Authenticate with passkey and evaluate PRF to derive encryption key material.
 *
 * @param credentialId - Base64url-encoded credential ID
 * @param prfSalt - 32-byte salt for PRF evaluation (must match for same output)
 * @returns PRF output (32 bytes) or null if PRF not supported
 */
export async function authenticateWithPrf(
  credentialId: ArrayBuffer,
  prfSalt: Uint8Array
): Promise<PrfResult> {
  const options: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [
      {
        type: 'public-key',
        id: credentialId,
      },
    ],
    extensions: {
      // Request PRF evaluation with our salt
      prf: {
        eval: {
          first: prfSalt,
        },
      },
    },
  };

  const assertion = (await navigator.credentials.get({
    publicKey: options,
  })) as PublicKeyCredential;

  // Extract PRF result from extension outputs
  const extensionResults = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfOutput = extensionResults.prf?.results?.first;

  return {
    credential: assertion,
    prfOutput: prfOutput ? new Uint8Array(prfOutput) : null,
  };
}
```

- No Better Auth coupling - works alongside existing passkey auth
- Uses native WebAuthn API for full control over PRF extension
- Returns raw 32-byte PRF output for key derivation
- Salt must be stored and reused to derive the same key later

### Step 4: Abstraction Layer - Passkey Vault (`src/lib/crypto/passkey-vault.ts`)

High-level API combining layers 1-3:

```typescript
export async function storeSecret(params: {
  secretType: 'fhe_keys' | 'wallet_key' | string;
  plaintext: Uint8Array;
  credentialId: string;
  prfOutput: Uint8Array;
}): Promise<EncryptedSecret>;

export async function retrieveSecret(params: {
  encryptedBlob: string;
  salt: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array>;

export async function reEncryptForNewPasskey(params: {
  existingBlob: string;
  existingSalt: string;
  oldPrfOutput: Uint8Array;
  newPrfOutput: Uint8Array;
}): Promise<EncryptedSecret>;
```

- Generic secret protection - not FHE-specific
- Handles salt generation internally

### Step 5: Database Schema (`src/lib/db/db.ts`)

```sql
CREATE TABLE encrypted_secrets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  secret_type TEXT NOT NULL,        -- 'fhe_keys', 'wallet_key', etc.
  encrypted_blob TEXT NOT NULL,     -- base64 ciphertext
  salt TEXT NOT NULL,               -- base64 PRF salt
  metadata TEXT,                    -- JSON for type-specific data
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, credential_id, secret_type)
);
```

### Step 6: tRPC Router (`src/lib/trpc/routers/secrets.ts`)

New router for encrypted secrets:

```typescript
// Protected procedures (require auth)
storeEncryptedSecret: Save blob + salt + credential_id + secret_type
getEncryptedSecrets: Get all secrets for user (for current passkey)
deleteEncryptedSecret: Remove specific secret
reEncryptSecrets: Batch re-encrypt when adding new passkey
```

### Step 7: Application Layer - FHE Key Store (`src/lib/crypto/fhe-key-store.ts`)

Refactor to use passkey-vault:

```typescript
export async function createAndStoreKeys(prfOutput: Uint8Array, credentialId: string): Promise<void>;
export async function retrieveKeys(prfOutput: Uint8Array): Promise<FheKeyMaterial>;
export async function addPasskeyAccess(oldPrf: Uint8Array, newPrf: Uint8Array, newCredId: string): Promise<void>;
```

- Generates FHE keys via TFHE WASM
- Delegates encryption to passkey-vault
- Handles FHE-specific metadata (key_id)

### Step 8: Onboarding Step (`src/components/onboarding/steps/step-secure-keys.tsx`)

New explicit step:

- PRF browser compatibility check with clear messaging
- Educational explanation of passkey-protected encryption
- Passkey registration with PRF extension enabled
- FHE key generation + encryption on success
- Success confirmation before proceeding

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/crypto/symmetric-crypto.ts` | Create | AES-256-GCM encryption primitives |
| `src/lib/crypto/key-derivation.ts` | Create | HKDF key derivation |
| `src/lib/crypto/webauthn-prf.ts` | Create | WebAuthn PRF extension handling |
| `src/lib/crypto/passkey-vault.ts` | Create | High-level secret protection API |
| `src/lib/crypto/fhe-key-store.ts` | Rewrite | Use passkey-vault, remove IndexedDB |
| `src/lib/crypto/tfhe-browser.ts` | Simplify | Only key generation, no persistence |
| `src/lib/db/db.ts` | Modify | Add encrypted_secrets table |
| `src/lib/trpc/routers/secrets.ts` | Create | tRPC router for encrypted secrets |
| `src/components/onboarding/steps/step-secure-keys.tsx` | Create | New onboarding step |
| `src/lib/crypto/__tests__/*.test.ts` | Create | Tests for each layer |

## Security Considerations

1. **Zero-knowledge preserved**: Server stores only encrypted blob, cannot derive key
2. **Hardware-backed**: PRF secret derived in authenticator's secure element
3. **No fallback**: Maintains security guarantee, accepts reduced browser compatibility
4. **Salt uniqueness**: Fresh random salt per encryption prevents rainbow attacks
5. **Key rotation**: If user removes passkey, encrypted keys become inaccessible (by design)

## Browser Support

| Browser | Version | Status | Notes |
|---------|---------|--------|-------|
| Chrome | 116+ | ✅ Supported | Full PRF support |
| Edge | 116+ | ✅ Supported | Chromium-based, same as Chrome |
| Firefox | 124+ | ✅ Supported | Added March 2024 |
| Safari macOS | 18+ | ⚠️ Limited | iCloud Keychain passkeys only |
| Safari iOS | 18+ | ⚠️ Limited | iCloud Keychain only, NO external security keys |
| Android Chrome | 116+ | ✅ Supported | Works with Google Password Manager |

### Platform-Specific Limitations

**Apple Devices (Critical):**

- PRF is ONLY supported with **iCloud Keychain** passkeys
- External security keys (YubiKey, etc.) do NOT support PRF on iOS/macOS Safari
- Users must use iCloud Keychain as their passkey provider

**Detection Strategy:**

```typescript
// After credential creation, check if PRF was actually enabled
const { credential, prfEnabled } = await createCredentialWithPrf(options);
if (!prfEnabled) {
  // Authenticator doesn't support PRF - show upgrade message
}
```

For unsupported configurations, show:

> "Zentity requires passkey PRF support to protect your encryption keys.
>
> **Supported:**
>
> - Chrome/Edge 116+ (desktop and Android)
> - Firefox 124+ (desktop)
> - Safari 18+ with iCloud Keychain
>
> **Not supported:**
>
> - External security keys on iOS/macOS Safari
> - Older browser versions
>
> If using a security key on Apple devices, please switch to iCloud Keychain or use Chrome/Firefox."

## Technical Notes

### Library Integration

- **Better Auth**: Does NOT support PRF natively. Our PRF module runs alongside BA without modification. Future upstream PR possible after implementation stabilizes.
- **SimpleWebAuthn**: Better Auth uses this internally, but we bypass it for PRF operations. SimpleWebAuthn intentionally keeps PRF support minimal and warns against using it for e2ee.
- **Dependencies**: No new dependencies required. Uses native WebCrypto + WebAuthn APIs. `@noble/hashes` available via Better Auth if HKDF fallback needed.

### Security Implementation Details

**HKDF Purpose Binding (Critical):**

```typescript
// CORRECT: Purpose-specific info parameter
info: new TextEncoder().encode('zentity-fhe-wrap-v1')

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

- PRF salt stored alongside encrypted blob on server
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
- [Firefox 124 Release Notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/124) - PRF extension support added
- [wwWallet Keystore Design](https://github.com/nickreynolds/nickreynolds.github.io/blob/main/prfkeystore.md) - Prior art for PRF-based key wrapping

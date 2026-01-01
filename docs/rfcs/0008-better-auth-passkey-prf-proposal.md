# RFC-0008: Better Auth Passkey PRF Extension Proposal

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2024-12-31 |
| **Updated** | 2024-12-31 |
| **Author** | Gustavo Valverde |

## Summary

Proposal for contributing WebAuthn PRF (Pseudo-Random Function) extension support to Better Auth's passkey plugin. This would enable privacy-preserving applications to use passkeys for both authentication AND client-side key derivation without maintaining separate WebAuthn implementations.

## Problem Statement

Better Auth's passkey plugin uses [SimpleWebAuthn](https://simplewebauthn.dev/) internally. While SimpleWebAuthn does support the PRF extension, Better Auth's abstraction layer doesn't expose it to consumers. This creates a gap for applications that need:

1. **Client-side key derivation** - Derive encryption keys from passkey authentication
2. **Zero-knowledge storage** - Store encrypted data that only the user can decrypt
3. **FHE key custody** - Wrap Fully Homomorphic Encryption keys with passkey-derived keys
4. **E2EE applications** - End-to-end encrypted messaging, notes, or file storage

### Current Limitation

Applications needing PRF must implement custom WebAuthn handling parallel to Better Auth:

```typescript
// Current workaround: Two separate passkey systems

// 1. Better Auth handles authentication
import { betterAuth } from "better-auth";
import { passkey } from "better-auth/plugins/passkey";

export const auth = betterAuth({
  plugins: [passkey()],
});

// 2. Custom implementation for PRF (duplicates WebAuthn logic)
async function authenticateWithPrf() {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: generateChallenge(),
      allowCredentials: [...],
      extensions: {
        prf: {
          eval: { first: salt },
        },
      },
    },
  });

  const prfOutput = credential.getClientExtensionResults().prf?.results?.first;
  // Now must verify assertion separately from Better Auth...
}
```

This duplication leads to:

- Maintaining two credential stores (Better Auth's + custom)
- Inconsistent session management
- Code complexity and potential security gaps
- Inability to leverage Better Auth's recovery flows for PRF-protected data

## Use Cases

### 1. Privacy-Preserving KYC (Zentity)

Zentity uses FHE for encrypted identity data. Users need to:

- Create a passkey during onboarding
- Derive a key-encryption-key (KEK) from passkey PRF
- Wrap FHE client keys with the KEK
- Store wrapped keys server-side (zero-knowledge)
- Unwrap keys on any device with the same passkey

Currently, Zentity maintains custom WebAuthn code separate from Better Auth.

### 2. End-to-End Encrypted Notes

A notes app using Better Auth could:

- Authenticate users with passkeys (via Better Auth)
- Derive per-vault encryption keys from PRF
- Encrypt notes client-side before storage
- Enable vault access from any authenticated device

### 3. Password Manager

A password manager could:

- Use passkey authentication (Better Auth)
- Derive master key from PRF output
- Encrypt password vault with master key
- No separate "master password" required

## Proposed Solution

### Option A: Expose PRF in Existing Plugin (Minimal)

Add optional PRF configuration to the existing passkey plugin:

```typescript
// better-auth/plugins/passkey/index.ts

interface PasskeyPluginOptions {
  // ... existing options
  prf?: {
    enabled: boolean;
    // Salt can be provided per-request or derived
    getSalt?: (userId: string) => Promise<Uint8Array>;
  };
}

export const passkey = (options?: PasskeyPluginOptions) => {
  return {
    id: "passkey",
    // ...
    endpoints: {
      // Existing endpoints enhanced
      passkeyAuthenticate: createEndpoint(
        // ...
        async (ctx) => {
          const { assertion, prfOutput } = await verifyAssertion(/*...*/);

          // Return PRF output alongside session if enabled
          return {
            session: await createSession(/*...*/),
            prfOutput: options?.prf?.enabled ? prfOutput : undefined,
          };
        }
      ),
    },
  };
};
```

Client-side usage:

```typescript
import { authClient } from "./auth-client";

const result = await authClient.passkey.authenticate();

if (result.prfOutput) {
  const kek = await deriveKeyFromPrf(result.prfOutput);
  const decryptedVault = await unwrapWithKek(kek, encryptedVault);
}
```

### Option B: Separate PRF Plugin (Modular)

Create a dedicated plugin that works alongside the passkey plugin:

```typescript
// better-auth/plugins/passkey-prf/index.ts

export const passkeyPrf = (options: PrfPluginOptions) => {
  return {
    id: "passkey-prf",
    dependencies: ["passkey"],
    endpoints: {
      // PRF evaluation during authentication
      evaluatePrf: createEndpoint(
        "/passkey-prf/evaluate",
        {
          method: "POST",
          body: z.object({
            credentialId: z.string().optional(),
            salt: z.string(), // Base64-encoded salt
          }),
        },
        async (ctx) => {
          const { session } = ctx;
          const salt = base64ToBytes(ctx.body.salt);

          // Client-side: triggers navigator.credentials.get with PRF
          // Server-side: verifies assertion, returns PRF output
          return { prfOutput: base64Encode(prfResult) };
        }
      ),

      // Store PRF salts per credential
      registerPrfSalt: createEndpoint(/*...*/),
    },
    schema: {
      passkeyCredential: {
        fields: {
          prfSalt: { type: "string", optional: true },
        },
      },
    },
  };
};
```

### Option C: Custom Extensions API (Most Flexible)

Allow arbitrary WebAuthn extensions through a generic API:

```typescript
// better-auth/plugins/passkey/index.ts

interface PasskeyPluginOptions {
  extensions?: {
    // Called before credential creation
    onCreateExtensions?: (ctx: CreateContext) => PublicKeyCredentialCreationOptionsExtensions;
    // Called before credential assertion
    onGetExtensions?: (ctx: GetContext) => AuthenticationExtensionsClientInputs;
    // Called after successful auth with extension results
    onExtensionResults?: (ctx: ResultContext, results: AuthenticationExtensionsClientOutputs) => Promise<void>;
  };
}
```

This allows PRF and future extensions without core changes:

```typescript
export const auth = betterAuth({
  plugins: [
    passkey({
      extensions: {
        onGetExtensions: (ctx) => ({
          prf: { eval: { first: getUserSalt(ctx.userId) } },
        }),
        onExtensionResults: async (ctx, results) => {
          if (results.prf?.results?.first) {
            ctx.response.prfOutput = results.prf.results.first;
          }
        },
      },
    }),
  ],
});
```

## Recommendation

**Option A (Expose PRF in Existing Plugin)** is recommended for initial contribution because:

1. **Minimal API surface** - Single boolean flag + optional salt function
2. **No breaking changes** - PRF is opt-in
3. **Aligns with SimpleWebAuthn** - Already has PRF support internally
4. **Covers 90% of use cases** - Key derivation after auth

Option C could be a follow-up for advanced use cases.

## Implementation Details

### Server-Side Changes

```typescript
// packages/better-auth/src/plugins/passkey/index.ts

import { verifyAuthenticationResponse } from "@simplewebauthn/server";

export const passkey = (options?: PasskeyPluginOptions) => {
  return {
    // ...existing implementation

    endpoints: {
      passkeyGetAuthenticationOptions: createEndpoint(
        // ...
        async (ctx) => {
          const options = generateAuthenticationOptions({
            rpID: ctx.context.options.rpID,
            allowCredentials: userCredentials.map(c => ({
              id: c.credentialID,
              type: "public-key",
              transports: c.transports,
            })),
            userVerification: "required",
            // NEW: Add PRF extension if enabled
            extensions: options?.prf?.enabled ? {
              prf: {
                eval: {
                  first: await options.prf.getSalt?.(userId) ?? generateRandomSalt(),
                },
              },
            } : undefined,
          });

          return { options, challenge: options.challenge };
        }
      ),

      passkeyVerifyAuthentication: createEndpoint(
        // ...
        async (ctx) => {
          const verification = await verifyAuthenticationResponse({
            response: ctx.body.response,
            expectedChallenge: ctx.body.challenge,
            expectedOrigin: ctx.context.options.origin,
            expectedRPID: ctx.context.options.rpID,
            credential: storedCredential,
          });

          if (!verification.verified) {
            throw new Error("Authentication failed");
          }

          // Create session
          const session = await ctx.context.session.create({
            userId: storedCredential.userId,
          });

          // NEW: Extract PRF output if available and enabled
          let prfOutput: Uint8Array | undefined;
          if (options?.prf?.enabled) {
            const extensions = ctx.body.response.clientExtensionResults;
            prfOutput = extensions?.prf?.results?.first;
          }

          return {
            session,
            // NEW: Include PRF output in response
            ...(prfOutput && { prfOutput: base64Encode(prfOutput) }),
          };
        }
      ),
    },
  };
};
```

### Client-Side Changes

```typescript
// packages/better-auth/src/client/plugins/passkey.ts

export const passkeyClient = () => {
  return {
    id: "passkey",

    authenticate: async (options?: {
      email?: string;
      // NEW: Client can request PRF evaluation
      prf?: { salt: Uint8Array };
    }) => {
      const authOptions = await fetch("/api/auth/passkey/authenticate/options");

      const credential = await navigator.credentials.get({
        publicKey: {
          ...authOptions,
          // NEW: Include PRF extension in client request
          extensions: options?.prf ? {
            prf: { eval: { first: options.prf.salt } },
          } : authOptions.extensions,
        },
      });

      const result = await fetch("/api/auth/passkey/authenticate/verify", {
        method: "POST",
        body: JSON.stringify({
          response: credential,
          challenge: authOptions.challenge,
        }),
      });

      // NEW: Return PRF output if present
      return {
        session: result.session,
        prfOutput: result.prfOutput ? base64ToBytes(result.prfOutput) : undefined,
      };
    },
  };
};
```

### Type Definitions

```typescript
// packages/better-auth/src/plugins/passkey/types.ts

export interface PasskeyPluginOptions {
  rpID?: string;
  rpName?: string;
  origin?: string | string[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;

  // NEW: PRF extension configuration
  prf?: {
    /** Enable PRF extension for key derivation */
    enabled: boolean;
    /**
     * Get salt for PRF evaluation. If not provided, a random salt is generated
     * and stored with the credential.
     */
    getSalt?: (userId: string, credentialId: string) => Promise<Uint8Array>;
  };
}

export interface PasskeyAuthenticateResult {
  session: Session;
  user: User;
  /** PRF output if enabled and supported by authenticator */
  prfOutput?: Uint8Array;
}
```

## Security Considerations

### PRF Output Handling

1. **Never log PRF outputs** - They are cryptographic secrets
2. **Transport security** - PRF outputs in responses must use HTTPS
3. **Memory management** - Clear PRF outputs after use
4. **Salt uniqueness** - Each user/credential should have unique salt

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| PRF output interception | HTTPS + httpOnly session cookies |
| Salt reuse attacks | Per-user, per-credential salts |
| Authenticator downgrade | Require PRF-capable authenticators or fail gracefully |
| Session fixation via PRF | PRF output bound to authenticated session |

### Graceful Degradation

Not all authenticators support PRF. The implementation should:

```typescript
const result = await authClient.passkey.authenticate({ prf: { salt } });

if (result.prfOutput) {
  // PRF available - use for key derivation
  const key = await deriveKey(result.prfOutput);
} else {
  // PRF not available - fall back to alternative
  // (e.g., prompt for password, magic link, etc.)
  console.warn("PRF not supported by this authenticator");
}
```

## Database Schema

If salt storage is needed (Option A with `getSalt` not provided):

```sql
-- Add to existing passkey_credential table
ALTER TABLE passkey_credential ADD COLUMN prf_salt TEXT;
```

Or as Drizzle migration:

```typescript
// migrations/add_prf_salt.ts
import { sql } from "drizzle-orm";

export async function up(db: DrizzleDB) {
  await db.run(sql`ALTER TABLE passkey_credential ADD COLUMN prf_salt TEXT`);
}
```

## Testing Strategy

### Unit Tests

```typescript
describe("passkey PRF extension", () => {
  it("includes PRF extension in authentication options when enabled", async () => {
    const plugin = passkey({ prf: { enabled: true } });
    const options = await plugin.endpoints.passkeyGetAuthenticationOptions.handler(ctx);

    expect(options.extensions?.prf).toBeDefined();
    expect(options.extensions?.prf?.eval?.first).toBeInstanceOf(Uint8Array);
  });

  it("returns PRF output in authentication result", async () => {
    // Mock credential with PRF extension result
    const result = await plugin.endpoints.passkeyVerifyAuthentication.handler({
      ...ctx,
      body: {
        response: mockCredentialWithPrf,
        challenge: mockChallenge,
      },
    });

    expect(result.prfOutput).toBeDefined();
    expect(result.prfOutput).toHaveLength(32);
  });

  it("does not include PRF when disabled", async () => {
    const plugin = passkey({ prf: { enabled: false } });
    const result = await plugin.endpoints.passkeyVerifyAuthentication.handler(ctx);

    expect(result.prfOutput).toBeUndefined();
  });
});
```

### Integration Tests

```typescript
describe("passkey PRF E2E", () => {
  it("derives consistent key from PRF output", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));

    // First authentication
    const result1 = await authClient.passkey.authenticate({ prf: { salt } });
    const key1 = await deriveKey(result1.prfOutput!);

    // Second authentication with same salt
    const result2 = await authClient.passkey.authenticate({ prf: { salt } });
    const key2 = await deriveKey(result2.prfOutput!);

    // Keys should be identical
    expect(key1).toEqual(key2);
  });
});
```

## Migration Path

### For Existing Better Auth Users

1. **No breaking changes** - PRF is opt-in
2. **Upgrade path**:

   ```typescript
   // Before (no change needed)
   export const auth = betterAuth({
     plugins: [passkey()],
   });

   // After (opt-in to PRF)
   export const auth = betterAuth({
     plugins: [passkey({ prf: { enabled: true } })],
   });
   ```

### For Applications Currently Using Custom PRF

1. Remove custom WebAuthn implementation
2. Use Better Auth's PRF-enabled passkey plugin
3. Update client code to use `authClient.passkey.authenticate({ prf: { salt } })`

## Open Questions

1. **Salt management** - Should Better Auth store salts, or require application to provide them?
   - Recommendation: Support both via optional `getSalt` callback

2. **Multi-passkey PRF** - Should PRF evaluation work across multiple passkeys?
   - Recommendation: Yes, via `evalByCredential` (SimpleWebAuthn supports this)

3. **Registration-time PRF** - Should PRF be evaluated during passkey creation?
   - Recommendation: Support but don't require (some authenticators don't support)

4. **Versioning** - How to handle PRF salt version changes?
   - Recommendation: Include version in HKDF info parameter

## References

- [WebAuthn PRF Extension Spec](https://w3c.github.io/webauthn/#prf-extension)
- [Yubico PRF Developer Guide](https://developers.yubico.com/WebAuthn/Concepts/Passkey_Encryption_PRF.html)
- [SimpleWebAuthn PRF Support](https://simplewebauthn.dev/docs/packages/browser#prf-pseudo-random-function)
- [RFC-0001: Passkey-Wrapped FHE Keys](./0001-passkey-wrapped-fhe-keys.md) - Zentity's custom implementation
- [Better Auth Passkey Plugin](https://www.better-auth.com/docs/plugins/passkey)

## Appendix: Zentity's Custom Implementation

For reference, here's how Zentity currently implements PRF outside Better Auth:

```typescript
// apps/web/src/lib/crypto/webauthn-prf.ts

export async function authenticateWithPasskey(
  options: AuthenticateWithPasskeyOptions
): Promise<AuthenticateWithPasskeyResult> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: options.challenge,
      allowCredentials: options.allowCredentials,
      userVerification: "required",
      extensions: {
        prf: {
          evalByCredential: options.credentialIdToSalt,
        },
      },
    },
  });

  const prfResults = credential.getClientExtensionResults().prf?.results;
  const prfOutputs = new Map<string, Uint8Array>();

  if (prfResults?.first) {
    prfOutputs.set(
      bufferToBase64Url(credential.rawId),
      new Uint8Array(prfResults.first)
    );
  }

  return {
    credential,
    prfOutputs,
  };
}
```

This implementation could be replaced with Better Auth's plugin if PRF support is added.

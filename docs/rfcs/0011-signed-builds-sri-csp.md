# RFC-0011: Signed Builds + SRI + CSP for Client Integrity

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-01-04 |
| **Updated** | 2026-01-04 |
| **Author** | Gustavo Valverde |

## Summary

Introduce a verifiable client integrity model by signing build artifacts,
enforcing Subresource Integrity (SRI) on static assets, and deploying a strict
Content Security Policy (CSP). The goal is to let users verify that the UI code
running in their browser matches a published, signed build.

## Problem Statement

Even if we never store plaintext PII, users still must **trust the client code**
we serve. Without integrity checks, the server (or a compromised CDN) could
deliver modified JavaScript that exfiltrates decrypted data. We need to
strengthen guarantees around code integrity and provenance.

## Goals

- Provide a **signed build manifest** that clients can verify.
- Add **SRI** for all static JS/CSS assets.
- Enforce a **strict CSP** to reduce script injection risk.
- Publish build identifiers that can be audited by users and partners.

## Non-goals

- Full reproducible builds across all environments.
- Preventing a compromised browser or malicious extensions.
- Replacing all dynamic Next.js runtime scripts.

## Design Decisions

1. **Signed build manifest**
   - CI generates a `build-manifest.json` containing SHA-256 hashes of all
     `/_next/static/*` assets.
   - Manifest is signed using an offline key (ed25519 recommended).

2. **SRI on static assets**
   - Add `integrity` attributes for JS/CSS assets in HTML.
   - For Next.js, use a build-time step to inject SRI (or Next config if available).

3. **Strict CSP**
   - Use CSP with nonces for inline scripts and disallow `unsafe-eval`.
   - Require trusted scripts to include either a nonce or SRI hash.

4. **Integrity bootstrap**
   - Serve the signed manifest at `/.well-known/zentity/build.json`.
   - Embed a small bootstrap verifier that:
     - validates the signature
     - verifies asset hashes before execution

## Architecture Overview

```text
CI build -> static asset hashes -> build-manifest.json -> signature
                               -> publish to /.well-known/
                               -> inject SRI into HTML
browser -> verify signature -> verify asset hashes -> run app
```

## Implementation Plan

- **CI**
  - Generate `build-manifest.json` from static asset hashes.
  - Sign with ed25519 private key stored in CI secrets.
  - Publish signature alongside manifest.

- **App**
  - Add a minimal bootstrap verifier (preload) that validates the manifest.
  - Inject SRI attributes for JS/CSS assets.
  - Add CSP headers:
    - `script-src 'self' 'nonce-<value>'`
    - `object-src 'none'`
    - `base-uri 'none'`

## Migration Strategy

- Roll out in staging first to confirm no CSP/SRI breakage.
- Then enable in production with monitoring and a rollback flag.

## Risks

- CSP/SRI may conflict with Next.js inline scripts or third-party libraries.
- Requires careful management of nonces for server-rendered HTML.

## Testing Plan

- Integration tests for CSP violations (report-only first).
- Validate that assets fail to load on SRI mismatch.
- Manual verification: compare `build.json` signature to published key.

## Open Questions

- Should we support a report-only CSP mode for local dev?
- Where should the public verification key live (repo + website + well-known)?

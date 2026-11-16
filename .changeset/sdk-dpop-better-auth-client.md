---
"@zentity/sdk": patch
---

`DpopClient` from `@zentity/sdk/rp` now signs proofs with Better Auth's DPoP client, which the SDK build bundles. Its API, the stored JWK format, and the seed-derived keys are unchanged, so derived `jkt` values stay the same.

- A `use_dpop_nonce` response that repeats the nonce the proof already carried is returned instead of retried.
- A 401 counts as a nonce challenge only under the `DPoP` scheme (`WWW-Authenticate: DPoP error="use_dpop_nonce"`).
- Proof `jti` values are 16 random bytes in base64url instead of a UUID, and `proofFor` uppercases standard methods in `htm`.

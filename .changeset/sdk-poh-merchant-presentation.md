---
"@zentity/sdk": minor
---

`@zentity/sdk/rp` verifies Proof-of-Human tokens as their audience.

- `createProofOfHumanTokenVerifier` requires `audience` (a client's `client_id`, or a merchant's origin) and checks `typ: poh+jwt`, `jti`, and `cnf.jkt`. Verified tokens include `aud`, `iat`, `jti`, `act`, and `authorizationDetails`, and `poh` is either the client-mode axes or a merchant-mode `MerchantProofOfHumanClaims` predicate (`isMerchantProofOfHumanClaims`).
- A merchant runs `verifyProofOfHumanPresentation` (the token and its DPoP proof, recording the proof `jti`), `assertIdentityStrength`, `assertApprovedRequirement` (the approved requirement equals the route's and the payment's), its facilitator's `/verify`, then `recordProofOfHumanUse` (the token's single use) before it settles. Failures throw `ProofOfHumanPresentationError` with a `code`, an HTTP `status`, and a `wwwAuthenticate` challenge. `createInMemoryProofOfHumanReplayStore` serves one instance.
- `@zentity/sdk/testing` adds `mockMerchantPohToken`, and `mockPohToken` takes `audience` and a required `confirmationJkt` and signs `typ: poh+jwt` tokens with a `jti`.
- `attachProofOfHumanToken`, `IDENTITY_STRENGTH_TIERS`, and `identityStrengthTier` are removed: the token never travels in the payment payload, and identity strength has no numeric form.

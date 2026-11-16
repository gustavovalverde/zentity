---
"@zentity/sdk": minor
---

The x402 client is rebuilt on `@x402/core` for merchants that require a Zentity Proof-of-Human.

- `createX402Fetch({ approve, issuer, maxAmount, maxIdentityStrength, schemeClient, fetch })` replaces the old signature. It checks a 402 before asking the user (a scheme client exists, the resource is on the request's origin, `auth-hints` names the issuer, no on-chain identity check, a registered asset within `maxAmount`, and an identity minimum within `maxIdentityStrength`), calls `approve` for the selected requirement, signs only that requirement with `@x402/core` spend controls capped at `maxAmount`, and retries with `PAYMENT-SIGNATURE` and the token as `Authorization: DPoP` from the approval's key. Refusals throw `X402PurchaseError` with a `code`.
- `createAgent` takes `x402SchemeClient`, and `agent.fetch(url, { x402: { maxAmount, maxIdentityStrength } })` runs one `x402_purchase` approval per purchase under a fresh DPoP key. `agent.proveHuman`, `ComplianceInsufficientError`, and the `autoPayWithProofOfHuman` option are removed, and `SdkErrorCode` no longer has `compliance_insufficient`.
- `buildX402PurchaseAuthorization` and `assertApprovedDetails` let a caller with its own approval flow build the entry and check the approved details.
- `@zentity/sdk/rp` adds `buildAuthHintsExtension`, `buildZentityExtension`, `readOAuthAuthHints`, `readZentityExtension`, and `PROOF_OF_HUMAN_CHALLENGE`, and `createPaymentRequired` takes `wwwAuthenticate`. `requestProofOfHumanToken` returns `expiresIn` and reads merchant-mode claims (`MerchantProofOfHumanClaims`) as well as client-mode ones.

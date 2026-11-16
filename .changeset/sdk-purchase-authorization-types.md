---
"@zentity/sdk": minor
---

`@zentity/sdk/protocol` defines the two purchase Rich Authorization Request types Zentity registers, and the helpers that bind an agent to the request it sends.

- `PurchaseAuthorizationSchema` (`type: "purchase"`): `merchant.name`, `item`, and an ISO 4217 `amount`. `X402PurchaseAuthorizationSchema` (`type: "x402_purchase"`): the merchant's `resource_url`, its x402 `payment_requirements` copied verbatim, and the `min_identity_strength` it requires. Both refuse unknown members, control and format characters, and agent-typed amounts on the x402 type.
- `AUTHORIZATION_DETAILS_TYPES` maps `payment_authorization`, `purchase`, and `x402_purchase` to their schemas.
- `IDENTITY_STRENGTHS` and `meetsIdentityStrength` name identity strengths (`documentary`, `documentary_full`, `cryptographic_chip`) in place of numeric levels.
- `REGISTERED_ASSETS`, `findRegisteredAsset`, `toAtomic`, and `formatAtomic` cover the one x402 asset Zentity accepts, Base Sepolia USDC, with integer arithmetic.
- `canonicalJson` serializes a JSON value as RFC 8785 does on its domain, and `taskHash` hashes the normalized CIBA request (binding message, sorted scopes, `acr_values`, and `authorization_details`) for an Agent-Assertion's `task_hash`.

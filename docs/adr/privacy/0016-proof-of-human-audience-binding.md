---
status: "accepted"
date: "2026-11-16"
builds-on: "[Assign disclosure claims to token and userinfo surfaces by claim class](0015-disclosure-surface-assignment.md)"
category: "technical"
domains: [privacy, security, web3, platform]
---

# Bind each Proof-of-Human token to one audience, and an x402 merchant's to one approval

## Context and Problem Statement

A Proof-of-Human (PoH) token states that a verified human is behind a request without naming them. Two parties use it: a relying party checking its own signed-in user, and an x402 merchant whom an agent pays on the user's behalf. The earlier token served both with one shape. It had no `aud` or `jti`, lived an hour, named the client's subject and the agent installation's DPoP key to every merchant, and travelled inside the x402 payment payload, so the facilitator that verifies payments received it too. The user approved an amount the agent typed rather than the merchant's terms.

Zentity does not sign or limit x402 payments yet: the agent pays from its own wallet. What Zentity controls is the statement about the user and who may present it.

## Priorities & Constraints

* A token reaches only the party it was minted for, once, for as short a time as the payment needs.
* No merchant can correlate the user, or the agent, with another merchant or with any client.
* The user approves what Zentity actually controls and sees the merchant's own terms.
* The facilitator never receives a Zentity token.
* Identity strength is named, not numbered, everywhere it travels.

## Decision Outcome

Chosen option: two token modes chosen by the presenting access token, both typed `poh+jwt`, EdDSA-signed, and DPoP-bound.

### Modes

The mint (`POST /api/auth/oauth2/proof-of-human`) reads the presenting access token's `authorization_details`. A token with one `x402_purchase` entry yields a merchant-mode token; any other `poh` token yields a client-mode token. The caller passes no audience.

* **Merchant mode.** `aud` is the origin `M` of the approved `resource_url`. `sub` is `pw(T(c, M), userId)`, where `T(c, M)` is the client's sector, a space, and `M`; `act.sub`, present only when a verified Agent-Assertion bound the request, is `pw(T(c, M), agentSessionId)`. Both are pairwise for every client, including one with a public subject type or the public agent opt-out, because the merchant is not that client. A space cannot occur in a client sector, so no merchant subject equals a subject any client holds, including a client registered at the merchant's host. Re-registering a client (a new `client/<id>` sector) gives the user a new subject at every merchant.
* **Client mode.** `aud` is the client's `client_id` and `sub` is the client's subject for the user. The token carries the identity, humanity, and policy axes, and answers `not_verified` for a user with neither identity nor humanity evidence.

### Claims

A merchant-mode token states only the predicate the merchant needs: `poh.identity.strength_at_least` (the merchant's `min_identity_strength`) and `poh.policy.version`. It copies the approved `x402_purchase` entry without `resource_description`, which only the user needed to read, and carries neither the user's own strength nor the humanity axis. A client-mode token states the user's own axes to the client the user signed in to: `poh.identity.verified`, `poh.identity.strength`, `poh.humanity.proven`, and `poh.policy.version`. Neither mode carries `client_id`, `azp`, `ba_sub`, or PII. Identity strength travels as `documentary`, `documentary_full`, or `cryptographic_chip`; no numeric level appears in a request, token, extension, or discovery document.

### Lifetime and single use

A client-mode token lives 300 seconds. A merchant-mode token lives until the earliest of 300 seconds, the requirement's `maxTimeoutSeconds`, and the CIBA token's expiry. Each carries a 128-bit random `jti`.

One `x402_purchase` approval mints one token. The mint first re-checks the user's identity strength (read only), then runs `UPDATE ciba_approval SET poh_minted_at, poh_jti WHERE reference_id = ? AND poh_minted_at IS NULL`; zero rows is `401 invalid_token`, the same answer as a strength that dropped after approval, so the agent cannot tell the two apart.

### Presentation

The agent generates a fresh DPoP key for each x402 approval, polls the CIBA token with it, mints with it, presents the PoH token to the merchant with it, and then discards it. The installation key never reaches a merchant. The PoH token travels as `Authorization: DPoP <poh>` with a DPoP proof over the merchant request, never in `PAYMENT-SIGNATURE`. The merchant's 402 says how: `WWW-Authenticate: DPoP algs="ES256"`, the x402 `auth-hints` extension naming Zentity's issuer and token endpoint, and `extensions.zentity = { info: { minIdentityStrength }, schema }`.

The merchant checks, in order: the PoH signature, `iss`, `typ`, `aud`, `exp`, and that its `jti` is unused (read only); the DPoP proof (`htm`, `htu`, `iat`, `ath`, the key equal to `cnf.jkt`, and an unused proof `jti`, recorded now); `strength_at_least` against its own minimum; that the token's `payment_requirements` equal its route requirement and the payment's `accepted` requirement, and that `resource_url` is the request URL; facilitator `/verify`; the PoH `jti`, recorded atomically; facilitator `/settle`. A failed payment therefore does not burn the approval.

### What the user approves

The approval surfaces present an x402 request as a Proof-of-Human for a named merchant: the statement Zentity signs, then the merchant's stated price paid by the agent's own wallet, then "Zentity does not sign or limit this payment." The user's identity strength is checked against the merchant's minimum at approval and again at the mint.

### Expected Consequences

* A PoH token is useless to any party other than its audience, after its first use at a merchant, or without the per-purchase key.
* Merchants cannot link a user, or an agent, across merchants through Zentity's identifiers.
* The payer address still links a user across merchants: the agent's own wallet pays every merchant. This remains until x402 payments are signed through Zentity's agent wallet (`payment_authorization`), which is the target and a later change.
* Until a source of scheme clients exists for the MCP server, MCP x402 purchases answer `payment_not_configured`; the agent journey runs with a test signer.
* A merchant needs a replay store shared by its instances for the PoH and DPoP `jti` values.

## Alternatives Considered

* **One token for every audience, passed downstream.** Rejected: an unaudienced, hour-long bearer of the client's subject is a correlator and a replayable credential.
* **An `audience` parameter on the mint.** Rejected: the approved entry already names the merchant, so a parameter only lets the caller choose wrongly.
* **A subject per merchant host only.** Rejected: two agent clients would show the same subject to one merchant, and the subject would equal that of a client registered at the merchant's host.
* **A separate issuance table for single use.** Rejected: `ciba_approval` already outlives the request and is keyed by the token's `reference_id`.
* **Burn the approval when the merchant first sees the token.** Rejected: a payment the facilitator refuses would cost the user a new approval.
* **Carry the token inside the payment payload.** Rejected: the facilitator would receive it.

## More Information

* Integration guide: [Proof of Human](<../../(protocols)/oauth-integrations.md#proof-of-human>)
* x402 presentation: [Web3 Architecture](<../../(architecture)/web3-architecture.md>)
* PACT §6.6, "Merchant-bound approvals": [PACT](<../../(specs)/pact-v0.1-draft.md>)
* Code authority: `apps/web/src/lib/auth/oidc/proof-of-human.ts`, `packages/sdk/src/x402.ts`, `packages/sdk/src/rp/proof-of-human.ts`

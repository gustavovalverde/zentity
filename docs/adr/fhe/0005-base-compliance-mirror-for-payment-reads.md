---
status: "accepted"
date: "2026-04-24"
category: "technical"
domains: [fhe, privacy, web3, product]
builds-on: "[Account-scoped identity snapshot and validity pipeline](../platform/0006-account-scoped-identity-snapshot-and-validity-pipeline.md)"
---

# Base compliance mirror for payment-time reads

## Context and Problem Statement

Zentity's authoritative identity verification and compliance derivation happen off-chain, and its encrypted on-chain attestation path lives on fhEVM Sepolia. Payment and resource-server integrations such as x402 need a low-latency, public `isCompliant(address,uint8)` read on Base without receiving raw PII, proof material, encrypted handles, or a custom Zentity API dependency in every settlement path.

The product question is where to place this public payment-time predicate. Putting it inside the encrypted fhEVM registry would weaken that registry's privacy role. Keeping it only in a Zentity HTTP token would force every on-chain or resource-server integration to trust a live Zentity API during payment authorization.

## Priorities & Constraints

* Keep the canonical compliance decision in Zentity's verification and validity pipeline.
* Preserve fhEVM contracts as encrypted-state contracts, not mixed plaintext compliance APIs.
* Expose only the smallest public state needed for payment-time and resource-server reads.
* Make the developer integration simple: one ABI, one deployment manifest, and one `isCompliant(user, minLevel)` read.
* Keep mirror writes operationally separate from proxy ownership and upgrades.
* Accept eventual consistency only when it is observable and retryable through the same delivery machinery as other validity side effects.

## Decision Outcome

Chosen option: deploy a narrow plaintext `IdentityRegistryMirror` on Base Sepolia and treat it as a public-read derivative of the canonical Zentity identity validity model.

The mirror stores only:

* whether a wallet has an active mirrored attestation;
* the current public numeric compliance level;
* a mirror-local attestation marker for lifecycle debugging.

It does not store PII, proof hashes, commitments, FHE ciphertext handles, policy evidence, document metadata, sanctions details, age predicates, jurisdiction predicates, or per-resource authorization state.

Writes come from Zentity's existing validity delivery pipeline:

1. A Sepolia attestation confirmation or refresh records a chain-sourced validity event.
2. The delivery worker schedules `mirror_compliance_write`.
3. The mirror writer reads the current compliance level from the identity read model at execution time.
4. The writer calls `recordCompliance(user, level)` with the Base registrar key.
5. Revocation schedules `mirror_revocation_write`, which calls `revokeAttestation(user)`.

The package `@zentity/contracts` exports the mirror ABI, deployment manifest, typed address helpers, and viem contract helper so resource servers can integrate without copying contract addresses or ABI JSON by hand.

### Expected Consequences

* x402 and similar payment flows get a cheap public compliance predicate on the chain where payment/resource integrations commonly run.
* Public observers can see wallet address, attested/revoked state, and numeric compliance level. That disclosure is intentional and bounded.
* The mirror is eventually consistent with Zentity's canonical read model, not an independent source of identity truth.
* Rich predicates require a new privacy review and either a dedicated predicate contract or an explicitly versioned mirror surface.
* Registrar key compromise can publish incorrect public levels until the key is rotated or paused. Production deployment needs protected registrar infrastructure and an operator runbook for emergency containment.

## Alternatives Considered

* **Expose plaintext `isCompliant` from the fhEVM registry.** Rejected because it mixes public predicates into the encrypted registry and invites future plaintext leakage from the wrong contract boundary.
* **Deploy the full encrypted registry on Base.** Rejected for the current implementation because the fhEVM Solidity configuration targets Zama's supported fhEVM network, while x402 needs Base-native reads today.
* **Use only short-lived Proof-of-Human HTTP tokens.** Rejected as the only mechanism because it does not support contract-native reads and makes resource servers depend on live Zentity API availability for every authorization path.
* **Mirror only a boolean.** Rejected because regulated resources need tiered requirements, and a boolean would force more contracts or off-chain logic as soon as the level scale matters.
* **Mirror the full registry shape.** Rejected because it would copy private architecture into a public surface and create an attractive path for future over-disclosure.

## More Information

* Runtime architecture: [Web3 Architecture](<../../(architecture)/web3-architecture.md>)
* Privacy boundary: [Attestation & Privacy Architecture](<../../(architecture)/attestation-privacy-architecture.md>)
* Payment integration: [RFC-0044: x402 Compliance Integration](../../rfcs/0044-x402-compliance-integration.md)
* Implementation plan: [PRD-29 Base mirror and contracts package](../../plans/prd-29-base-mirror-and-contracts-package.md)
* Product task: [PRD-39 x402 compliance oracle](../../plans/tasks/prd-39-x402-compliance-oracle.md)

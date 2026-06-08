# PCZT Updater mutation of `global.expiry_height` produces `SighashMismatch` at Extractor

**Status**: blocked on upstream PCZT pipeline investigation
**Date**: 2026-06-08
**Affects**: `pczt` 0.7.0, `zcash_primitives` 0.28.0, `orchard` 0.14.0

## Symptom

A wallet runtime that mutates `Pczt::global::expiry_height` between Constructor and Prover, then runs the standard Prover → Signer → Extractor pipeline, hits `TransactionExtractor::extract` returning `SighashMismatch`. No mutation produces a working tx.

## Setup

- One Orchard spend, one Orchard output (no transparent inputs/outputs, no Sapling)
- Wallet's storage built a PCZT via `zcash_client_backend::data_api::wallet::create_pczt_from_proposal`
- A standalone wire-format Updater mutates only `Pczt::common::Global::expiry_height` (postcard layout mirror; byte-identical round-trip verified)
- Signer and Extractor are the upstream `pczt::roles::signer::Signer` and `pczt::roles::tx_extractor::TransactionExtractor`

## Observed sighashes (real wallet, testnet)

Logged via `pczt::roles::signer::Signer::new(parsed).shielded_sighash()` at each pipeline stage on the post-stage bytes:

| Stage                         | `global.expiry_height` | Shielded sighash                                                   |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------ |
| After `create_pczt_from_proposal` | 4053374              | `8b1ea8a3872b13646304e7eeb0b6cf2f60b765f796c6242771828b7eb76df6ef` |
| After Updater (mutate to 4052039) | 4052039              | `2a187ee61f886330d90812188ad5f2052c87456919123e8ef96d972475bc23d5` |
| After Prover                  | 4052039                | `2a187ee61f886330d90812188ad5f2052c87456919123e8ef96d972475bc23d5` |
| After Signer                  | 4052039                | `2a187ee61f886330d90812188ad5f2052c87456919123e8ef96d972475bc23d5` |

Re-running `Signer::new(...).shielded_sighash()` on the signed bytes returns the same `2a18...23d5`. So the Signer-side sighash is consistent end-to-end.

Postcard round-trip with `target_expiry_height == proposed_expiry_height` (semantic no-op) produces byte-identical output (`len_before == len_after`, no first byte difference). The mirror is wire-correct.

Despite the consistent sighash, `TransactionExtractor::extract` returns:

```text
PCZT error: Failed to extract the final transaction: SighashMismatch.
```

That error originates in `orchard::pczt::tx_extractor::Bundle::<Unbound>::apply_binding_signature`, when the action's `rk.verify(&sighash, action.authorization()).is_ok()` fails for at least one action.

## What this implies

The Signer signs `spend_auth_sig` with `rsk.sign(rng, sighash_signer)`. The Extractor verifies with `rk.verify(sighash_extractor, sig)`. ZIP-244 says shielded sighash is authorization-agnostic, so `sighash_signer == sighash_extractor` should hold given identical bytes. The empirical mismatch suggests one of:

1. `Pczt::extract_tx_data::<Unbound, _>` (Extractor path) constructs a `TransactionData` whose ZIP-244 digest differs from the `Pczt::extract_tx_data::<EffectsOnly, _>` path (Signer path) on the same input PCZT bytes.
2. A field that participates in the ZIP-244 digest is captured at Signer-construct time and re-read post-mutation at a different value in one of the two paths.

In both cases, the failure is triggered by mutating `global.expiry_height` after Constructor. Without the mutation the same pipeline succeeds (the Phase 5 demo flow has produced a real testnet broadcast outcome).

## Minimal reproduction shape

```rust
let proposed: Vec<u8> = create_pczt_from_proposal(/* one orchard spend, one orchard output */)?.serialize();

// Mutate only Global::expiry_height via postcard wire mirror (or any upstream-supported route).
let mutated = updater_set_expiry_height(proposed, target_expiry)?;

// Standard pipeline.
let proven = pczt::roles::prover::Prover::new(...).prove()?.serialize();
let signed = pczt::roles::signer::Signer::new(pczt::Pczt::parse(&proven)?)
    .sign_orchard(0, &ask)?
    .finish()
    .serialize();
let _: Transaction = pczt::roles::tx_extractor::TransactionExtractor::new(
    pczt::Pczt::parse(&signed)?
).extract()?;  // SighashMismatch.
```

## Workaround paths

- Have the upstream Updater expose `global.expiry_height` mutation through `pczt::roles::updater::Updater` (it is currently `pub(crate)` on `GlobalUpdater`) AND verify the post-Updater pipeline produces a valid sighash, fixing whichever path diverges.
- Or expose a caller-supplied `expiry_height` parameter on `propose_standard_transfer_to_address` so callers don't need a post-hoc Updater.
- Or add a `Pczt::diagnostic_shielded_sighash_with_authorization<A>()` so callers can verify which path is producing which sighash without running the full Extractor.

For wallet operators today, the practical mitigation is to let the wallet derive its own expiry from the same chain source the BFF uses, with /settle accepting a range around the prepared value instead of point equality.

## Related upstream tracking

- `zcash/librustzcash#2380` ("Allow caller-controlled expiry on propose_standard_transfer_to_address") and the linked draft PR `#2398` cover the proposal-time approach; this finding documents that the Updater workaround does not work on the post-Constructor path either.

# PCZT Updater mutation of `global.expiry_height` invalidates dummy-action signatures

**Status**: ROOT CAUSE FOUND. Upstream patch validated end-to-end.
**Date**: 2026-06-08
**Affects**: `pczt` 0.7.0, `zcash_client_backend` 0.23.0, `orchard` 0.14.0

## Symptom

A wallet runtime that mutates `Pczt::common::Global::expiry_height` between
Constructor and Prover via a postcard wire mirror, then runs the standard
Prover → Signer → Extractor pipeline, hits `TransactionExtractor::extract`
returning `SighashMismatch` on every call. No mutation produces a working tx.

## Root cause

`zcash_client_backend::data_api::wallet::create_pczt_from_proposal` runs three
steps in sequence on the Builder's output:

1. `Creator::build_from_parts(build_result.pczt_parts)`: copies
   `PcztParts::expiry_height` into the PCZT's `Global::expiry_height`.
2. `IoFinalizer::new(created).finalize_io()`:
   - Computes the shielded sighash over the freshly-built tx_data.
   - Calls `orchard::pczt::Bundle::finalize_io(sighash, _)` which signs every
     dummy action with its `dummy_sk` against the just-computed sighash, then
     **takes (consumes) `dummy_sk` from the PCZT**
     (`io_finalizer.rs:51`: `if let Some(sk) = action.spend.dummy_sk.take()`).
3. The wallet returns the finalized PCZT bytes to the caller.

A later Updater that mutates `global.expiry_height` produces a PCZT whose new
shielded sighash differs from the one IoFinalizer originally used:

- The real spend's `spend_auth_sig` is added later by the Signer against the
  new sighash, so its verify passes at extract time.
- The dummy action's `spend_auth_sig` was committed by IoFinalizer against the
  pre-Updater sighash, and `dummy_sk` is gone, so it cannot be re-signed. The
  Extractor's per-action verify fails for the dummy with `SighashMismatch`.

The failure is per-action, not per-bundle: in two runs with different note
selections, the verify split is consistent (real spend OK, dummy spend NOT
OK).

## Trace excerpt (post-fix, verifying the explanation)

When `PcztParts::expiry_height` is set to the target value before
`Creator::build_from_parts`, IoFinalizer signs the dummy against the SAME
sighash the Extractor recomputes:

```text
[PCZT SIGNER DEBUG]   cached shielded_sighash   = b8 77 13 23 2f fb ec f6 ...
[PCZT EXTRACTOR DEBUG] extractor shielded_sighash = b8 77 13 23 2f fb ec f6 ...
[ORCHARD APPLY BINDING SIG DEBUG] action[0] verify_ok = true
[ORCHARD APPLY BINDING SIG DEBUG] action[1] verify_ok = true
```

Without the fix (PCZT Updater mutates expiry post-IoFinalizer), one action
verifies and the other doesn't:

```text
[ORCHARD APPLY BINDING SIG DEBUG] action[0] verify_ok = true   # real spend (Signer)
[ORCHARD APPLY BINDING SIG DEBUG] action[1] verify_ok = false  # dummy (IoFinalizer)
```

Postcard round-trip with `target == proposed` is byte-identical, so the wire
mirror is correct; the breakage is purely semantic.

## Proposed upstream fix

Add an optional `target_expiry_height` parameter to
`zcash_client_backend::data_api::wallet::create_pczt_from_proposal`. Apply it
between `build_for_pczt` and `Creator::build_from_parts`:

```rust
let mut build_result = build_state.builder.build_for_pczt(OsRng, fee_rule)?;

if let Some(target) = target_expiry_height {
    build_result.pczt_parts.expiry_height = target;
}

let created = Creator::build_from_parts(build_result.pczt_parts)
    .ok_or(PcztError::Build)?;
let io_finalized = IoFinalizer::new(created).finalize_io()?;
```

`PcztParts::expiry_height` is already a `pub` field on the published struct,
so the change is purely additive at the API boundary. The Creator copies the
field into `Global::expiry_height` and IoFinalizer then computes its sighash
from that value, so dummies are signed against the same sighash the Extractor
will recompute later.

Closes the consensus-relevant gap tracked at
`zcash/librustzcash#2380` and `zcash/librustzcash#2398` from the wallet-layer
side: the wallet picks its own expiry today; the upstream API just needs the
caller-supplied value to land before IoFinalizer instead of after.

The PCZT `Updater` role at the wire layer remains useful as a primitive for
fields that do NOT participate in the shielded sighash (`coin_type`,
`tx_modifiable`, `proprietary` entries). Mutation of `expiry_height`,
`consensus_branch_id`, `fallback_lock_time`, or `tx_version` after IoFinalizer
must not be attempted because each invalidates dummy `spend_auth_sig`s with
no recovery path.

## End-to-end validation

Local patches confirming the fix:

- `~/dev/zfnd/zcash_client_backend-debug` (registry copy with the new
  `target_expiry_height` parameter and the `PcztParts` mutation).
- `~/dev/zfnd/pczt-debug` and `~/dev/zfnd/orchard-debug` (registry copies
  with `eprintln` instrumentation across `Signer::new`,
  `TransactionExtractor::extract`, `Bundle::commitment`, and
  `apply_binding_signature`).
- `zally-storage` calls `create_pczt_from_proposal(..., Some(target))` and the
  full propose → Updater (no-op) → prove → sign → extract pipeline succeeds
  on a real testnet wallet; `/v1/payments/sign` returns 200 with valid signed
  bytes.

Reproduction layout matches the published 0.7.0 / 0.14.0 / 0.23.0 versions
(registry sources copied verbatim with only the diagnostic + one-field
patches applied).

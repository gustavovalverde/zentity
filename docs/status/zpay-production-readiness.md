# zpay production-readiness status

**As of**: 2026-06-08
**Phase model reference**: [`zpay/docs/proposals/0003-agent-wallet-production-architecture.md`](https://github.com/gustavovalverde/zpay/blob/main/docs/proposals/0003-agent-wallet-production-architecture.md) (Phases 1–8, design decisions D-1–D-15).
**Latest E2E proof**: testnet tx `f5b8cecd63c85739a4dec7d2a525bb2a5f8525b8e616752e944cf2660f6d91dd`, mined at block 4,053,923, expiry 4,053,961, visible at <https://zexplorer.app/testnet/tx/f5b8cecd63c85739a4dec7d2a525bb2a5f8525b8e616752e944cf2660f6d91dd>.

This document captures three things: what's done, what's stubbed, and what to build next, in priority order. Production readiness here means "the BFF→wallet trust boundary is real, the chain status is observable, and the deploy story exists outside of `docker compose up` on a laptop".

## 1. Snapshot

| Phase | State | Evidence |
|---|---|---|
| Phase 1: vocabulary + dead-code removal | done | merged to zally/zpay main long ago |
| Phase 2: PCZT wire + trait consolidation + chain-neutral types | done | task #67 |
| Phase 3: zentity RAR + revocation + signed approval card | done | task #68 |
| Phase 4: zspend-runtime binary (Phase 4 MVP) | done | task #69 still tracks "Phase 7-8 ops hardening (deferred)"; the binary is up |
| Phase 4 follow-on: real DPoP + at+jwt + JWKS + RAR + revocation + jti | **stubbed** | `/v1/payments/sign` and `/x402/v2/prepare` accept caller-supplied state without verifying the access token |
| Phase 5: Aether flow end-to-end in demo-rp | partial | BFF orchestrator at `/api/aether/sign` lands; probe goes prepare→sign→settle; CIBA approval card not driven end-to-end |
| Phase 6: External wallet path | not started | only zspend-runtime in scope today |
| Phase 7: Operator surfaces and KMS sealing | not started | `wallet.age` is a dev-only file seal; no KMS plane |
| Phase 8: Hardening and security model doc | not started | this document is the precursor |

## 2. What's been demonstrated empirically

Each row is a real result you can re-run with the listed command, not a design assertion.

| Capability | Evidence | How to re-run |
|---|---|---|
| Full HTTP wire from `/prepare` to `/settle` to a mined testnet tx | tx `f5b8cecd...0f6d91dd`, block 4,053,923, 21 confirmations | `pnpm --filter @zentity/demo-rp exec tsx scripts/probe-e2e.mts` |
| Caller-controlled expiry, bit-exact through to consensus | on-wire `nExpiryHeight = 4053961` equals `/prepare` value and `/sign` `target_expiry_height` | same probe; decode response bytes at offset 16..20 |
| Stale-target rejection | `target_expiry_height=0` returns HTTP 409 `target_expiry_stale` with caller value and observed tip in the detail | `curl` to `/v1/payments/sign` with `target_expiry_height: 0` |
| Double-spend rejection bubbling from chain | second probe of the same orchard input returns `kind=rejected` with `Nullifier(0x...) in finalized state: false` | rerun probe without re-funding wallet |
| RFC 7807 error envelope across all three endpoints | every non-2xx response carries `application/problem+json` with `kind/title/detail/retryable` | inspect `/prepare`, `/sign`, `/settle` error responses |
| Idempotency on `/prepare` | `payment_id` + `idempotency_key` + `nonce` resolve to the same row across replays | invoke `/prepare` twice with the same key |
| Wire-stable intent commitment | `v1:sha256` intent_hash over CAIP-typed RAR tuple equals what the SDK recomputes | probe parses the RAR locally and matches |
| PCZT pipeline survives a real network swap | same code path works against local zinder/zebra and Railway zinder/zebra; we swapped mid-session | export `ZSPEND_CHAIN_SOURCE_URL` / `ZPAY_CHAIN_SOURCE_URL` and restart |
| DPoP-bound calls | ES256 DPoP proofs minted from a deterministic seed verify against the published jkt | probe derives DPoP key from `ZPAY_DPOP_KEY_SEED` |
| Wallet returns valid signed bytes | bytes parse as v5 transaction, are accepted by zebra, mine into a block | mine on zexplorer |

These are demonstrated **as code paths**. They are not demonstrated as **policy-enforced contracts**, because the verifiers are stubbed; see §3.

## 3. What's stubbed today

Grouped by the architecture decision they implement (D-codes refer to Proposal-0003 §3).

### A. The BFF→wallet trust boundary is not enforced (Phase 4 follow-on)

Every item here is documented in `zspend-runtime/src/main.rs` as `TODO(phase-4-followup)`.

- **DPoP proof verification on `/v1/payments/sign`**: D-1, D-5. The current binary accepts inbound calls without validating the DPoP header. The probe sends one because zpay's `/prepare` requires it, not because zspend checks.
- **`at+jwt` access token presentation and verification**: D-1, D-2. There is no `Authorization: DPoP <jwt>` parsing yet. The BFF trusts session auth instead of presenting an access token to zspend.
- **JWKS plumbing and cache**: D-2. `readyz` reports `jwks_cache: unused`. The runtime has no JWKS fetcher, no key rotation, no offline cache.
- **Audience pin (jkt thumbprint)**: D-5. `ZSPEND_AUDIENCE_THUMBPRINT` env var exists with a Phase 4 default of `phase4-stub-thumbprint`. Not validated against the token's `aud`.
- **Revocation cache and delta stream**: D-6. `readyz` reports `revocation_cache: unused`. Nothing subscribes to zentity's revocation endpoint.
- **Single-use `jti` ledger**: D-8. The runtime currently keys idempotency by `payment_id`. A replay of the same `jti` would mint a fresh PCZT. Spec says write-then-sign against the ledger.
- **RAR recompute and audit**: D-4. zspend does not recompute the `intent_hash` from the parsed ZIP-321 URI. The probe never lies about it, but a hostile BFF could.
- **`payment_request` scheme guard**: D-11. The runtime accepts only `zip321` (correctly), but doesn't audit canonicalization.

### B. Lifecycle and finality observability

- **Explorer plane**: D-12. `ZPAY_EXPLORER_URL` is unset, so `/x402/v2/verify` reports `chain_presence=oracle_unavailable`. Status vocabulary defines `awaiting → broadcast → mined → final` but the last two require an oracle.
- **SSE event stream**: `/x402/v2/payments/{id}/events` exists. The probe doesn't exercise it. No regression test today.
- **`confirmation_count`, `mined_block_height`**: present in the payment-status shape, always null today.

### C. CIBA and end-user flow

- **Aether CIBA approval card through to `/sign`**: D-7. The signed approval card RFC exists (zentity Phase 3). The probe bypasses the CIBA approval and calls the BFF orchestrator directly with a session cookie.
- **Step-up re-auth on `/sign` ACR mismatch**: zentity has the FPA challenge endpoint. zpay doesn't reject on ACR yet because token verification is stubbed.
- **Ephemeral PII delivery (5-min TTL)**: implemented in zentity for OAuth/CIBA. Not exercised through a zpay-mediated spend in the probe.

### D. Deploy story

- **Per-instance secrets**: `docker-compose.yml` uses a stable dev seed for DPoP. No per-instance key generation or rotation.
- **KMS sealing for the wallet seed**: `wallet.age` is a file with an embedded identity. Phase 7 calls for KMS unwrap.
- **Railway / Vercel / fly config for zpay + zspend**: no manifests. Only zinder runs on Railway today.
- **Persistent storage for zspend wallet across redeploys**: docker volume only.
- **Production `zcash_client_backend`**: pointing at `gustavovalverde/zcash_client_backend-target-expiry` at tag `v0.23.1-target-expiry`. Drops when [librustzcash#2412](https://github.com/zcash/librustzcash/pull/2412) merges and ships.

### E. Bugs noted in passing

- **`signed_payload.tx_id` vs `broadcast_outcome.transaction_id` disagree**: the two display orders don't reverse-match. `to_rpc_hex()` on the broadcast side does the standard reversal; the wallet's `tx.txid()` does not produce a hash that reverses to that value. Cosmetic but real. Filed for a follow-up slice.
- **`signed_payload.fee` is always `{"value":"0"}`**: zally's `SubmitOutcome::Accepted` doesn't carry the fee; zspend hardcodes zero. Need to thread `zcash_primitives` fee through.

### F. Wallet operability gaps

- **Wallet funding loop**: each probe consumes one orchard note and the next attempt fails on duplicate nullifier until you refund via `fauzec.com` and rescan. No automated refunder.
- **Receiver-side rescan**: a fresh wallet replaying the same seed picks up the funds again, but the operational path (rotate seeds, archive old wallet) is not specified.

## 4. Implementation order to production

Read this as "what unblocks what". Each phase ends with an empirical gate that has to pass before the next starts.

### Slice 1: Real trust boundary on `/v1/payments/sign` (D-1, D-2, D-5, D-6, D-8)

This is the security-critical work. Until it lands, zspend is a network-reachable signing oracle.

Order inside the slice:

1. **JWKS fetcher + cache** (D-2). The runtime needs to fetch zentity's JWKS at startup, cache it with an `expiresAt` honoring `Cache-Control`, and refresh on `kid` miss. Loads from `ZENTITY_ISSUER_URL`.
2. **`at+jwt` parse and signature verify** (D-1). `Authorization: DPoP <jwt>` parsing; alg in {ES256, EdDSA, ML-DSA-65, RS256} from the JWT header; signature verify against the cached JWKS. Reject `none` and unknown alg.
3. **DPoP proof verification** (D-5). Verify the DPoP header proves possession of the key whose `jkt` matches `cnf.jkt` in the access token. Verify `htm`/`htu` match, `jti` unique, `iat` within the configured skew.
4. **Audience pin** (D-5). Compare `aud` against `ZSPEND_AUDIENCE_THUMBPRINT`; reject mismatch with `audience_mismatch`.
5. **RAR recompute and intent_hash audit** (D-4). Recompute the canonical `intent_hash` from the parsed `payment_request`, compare against the RAR's `intent_hash`; reject mismatch with `intent_mismatch`.
6. **Single-use `jti` ledger** (D-8). Write-then-sign: persist `jti` (with TTL) before signing, reject on replay with `token_already_consumed`.
7. **Revocation cache** (D-6). Subscribe to zentity's revocation SSE; cache by `jti` with delta updates; reject revoked tokens with `access_token_invalid`.

Empirical gate: `probe-e2e.mts` continues to pass; a new `probe-spoof.mts` exercises replayed `jti`, mutated `intent_hash`, wrong-audience token, and revoked token, each expecting the correct `kind`.

### Slice 2: Finality and observability

Once spending is locked down, make settlement legible.

1. **Wire `ZPAY_EXPLORER_URL`** to zinder's explorer service. Have `/x402/v2/verify` poll for `chain_presence` and report it.
2. **Confirmation tracking**. Have the settle row update `confirmation_count` and `mined_block_height` as blocks roll in; expose via `/x402/v2/payments/{id}`.
3. **SSE event stream coverage**. Extend the probe to subscribe to `/events` and assert it observes `broadcast`, `mined`, and `final` states for the same `payment_id`.
4. **Finality threshold env**. `ZPAY_FINALITY_DEPTH` (already a constant; surface as env).

Empirical gate: probe extended to wait for `final`; tx `f5b8cecd...` shows the same lifecycle.

### Slice 3: CIBA and approval card end-to-end

Tie zentity Phase 3 into the probe.

1. Drive the Aether agent flow through `/api/auth/oauth2/par` → `/api/oauth2/authorize-challenge` → CIBA push approval → token at + DPoP-bound issuance, then call zspend.
2. Add a `probe-aether.mts` that walks the agent path end-to-end (separate from the BFF-orchestrator probe).
3. Step-up re-auth path: when `acr_values` is below the token's tier, the FPA endpoint must return 403 with `auth_session`.
4. Ephemeral PII consume: a spend that asserts `proof:*` scopes should land the claims on the id_token, with the in-memory TTL store consuming them on first read.

Empirical gate: an end-user (or a scripted CIBA approver) approves on `/approve/[authReqId]` and the probe sees `kind=accepted` on `/settle`.

### Slice 4: Deploy story

1. **Per-instance secret material**: `BETTER_AUTH_SECRET`, `OPAQUE_SERVER_SETUP`, `DPOP_KEY_SEED`, `PAIRWISE_SECRET`, all min-32 char, generated per environment.
2. **Sealed-seed posture transition**: ship Phase 7 KMS unwrap (aws-kms, gcp-kms, or sops as a stop-gap). `wallet.age` becomes the dev posture only.
3. **Container images for `zpay-runtime`, `zspend-runtime`**: push to a registry; pin SHA-256 digests in deploy manifests.
4. **Railway / Vercel deploy manifests**: zinder already runs on Railway; add zpay and zspend services with the same posture. Persistent volume for `zspend-data`.
5. **`zcash_client_backend` cleanup**: when [librustzcash#2412](https://github.com/zcash/librustzcash/pull/2412) merges and a release ships, drop the `[patch.crates-io]` in zally and zpay.

Empirical gate: the probe passes against a Railway-deployed zpay + zspend with no local docker.

### Slice 5: Polish

1. Fix the `tx_id` vs `transaction_id` display mismatch. Likely a `to_rpc_hex` mis-application or an upstream encoding difference in zinder.
2. Thread the real fee through to `signed_payload.fee`.
3. mainnet posture: `payee` mainnet config; network-pinned `ZPAY_NETWORK`; `cargo build --features mainnet` semantics audit.
4. PCZT `Updater` follow-ons: now that the expiry use case is gone, exercise the primitive on a non-sighash field (e.g. `coin_type` audit) to keep it warm and tested.

### Slice 6: Hardening (Proposal-0003 Phase 8)

1. Rate limits on `/prepare`. Sybil window per `payee_id` + per source IP.
2. Idempotent settlement under retries: `settle` must produce identical persisted state on replay; today it depends on the broadcaster's idempotency.
3. Failure-mode coverage tests: chain unavailable, wallet circuit broken, JWKS unavailable, zinder returning ambiguous outcomes.
4. Security model doc lands; threat enumeration aligned with the existing tamper-model and attestation-privacy docs in zentity.

## 5. Test strategy

The pyramid we want, from cheapest to most expensive.

### 5.1 Per-piece, in-process

These already exist for the most part. The gap is coverage on the verifier paths once Slice 1 lands.

| Service | Suite | Where | What's covered today | What's missing |
|---|---|---|---|---|
| zally-wallet | `cargo test -p zally-wallet --test acceptance --features zally-chain/zinder` | `crates/zally-wallet/tests/acceptance.rs` | 47 tests including the stale-target rejection | tests for `target_expiry_height` end-to-end via a regtest fixture |
| zally-pczt | `cargo test -p zally-pczt` | `crates/zally-pczt/src/updater.rs::tests` | postcard round-trip + mutation byte-diff + truncated header | `Updater` regression once a non-expiry mutation lands |
| zspend-core | `cargo test -p zspend-core` | `crates/zspend-core/src/error.rs::tests` | `ProblemKind` serialization, remediation hint shape | new test for `target_expiry_stale` / `target_expiry_mismatch_internal` |
| zspend-runtime | `cargo test -p zspend-runtime` | `crates/zspend-runtime/src/main.rs::tests` | 16 tests including bootstrap and capture-submitter | per-Slice-1 verifier tests (JWKS, jti ledger, audience, RAR) |
| zpay-core / zpay-x402 | `cargo test -p zpay-core -p zpay-x402` | settle, broadcast, problem mappings | broadcast outcome translation | per-Slice-2 confirmation tracker, SSE wiring |
| zentity oauth + ciba + zk + identity | `pnpm test:unit` / `pnpm test:integration` in `apps/web` | vitest configs | the existing routers and PCZT helpers | Slice 1 stubs land here too: token claim shape, RAR builder, intent_hash |

### 5.2 Cross-service, single-host (the probe)

The black-box probe at `apps/demo-rp/scripts/probe-e2e.mts` is the truth oracle for the wire. It:

1. mints a DPoP key from a known seed,
2. calls `/x402/v2/prepare` and parses the RAR,
3. recomputes `intent_hash` against `@zentity/sdk/protocol`,
4. calls `/v1/payments/sign` with `target_expiry_height`,
5. forwards the signed bytes to `/x402/v2/settle`,
6. prints PASS/FAIL with a tail per step.

For each Slice, extend the probe (or add a sibling probe) rather than rely on unit tests alone:

- `probe-spoof.mts` (Slice 1): replayed `jti`, mutated `intent_hash`, wrong-audience token, revoked token. Each expects the correct error `kind`.
- `probe-aether.mts` (Slice 3): drives the CIBA approval card through to `/settle`.
- `probe-lifecycle.mts` (Slice 2): subscribes to `/events`, asserts `broadcast → mined → final` for one `payment_id`.

### 5.3 Cross-host, real testnet (the gate that just passed)

The current command, ground-truth verified:

```bash
# 1. Point both services at Railway zinder (live testnet)
export ZPAY_CHAIN_SOURCE_URL=http://acela.proxy.rlwy.net:48119
export ZSPEND_CHAIN_SOURCE_URL=http://acela.proxy.rlwy.net:48119

# 2. Boot the stack
cd ~/dev/zfnd/zpay && docker compose up -d zpay
./target/release/zspend-runtime serve &

# 3. Run the probe
cd ~/dev/personal/zentity/apps/demo-rp && pnpm exec tsx scripts/probe-e2e.mts

# 4. Verify on chain
open https://zexplorer.app/testnet/tx/<broadcast_outcome.transaction_id>
```

This is the gate every Slice must continue to pass.

### 5.4 Production-deploy verification (Slice 4 only)

Scheduled probe from a separate host, hitting the public URL of the deployed zpay + zspend. The probe lives in CI and runs every 5 minutes. The probe's `target_expiry_height` floor is the actual chain tip from zexplorer, not a hardcoded `4_052_039`.

### 5.5 The four claims to keep validated

A regression on any of these is a production incident:

1. The wire shape at every error boundary is `application/problem+json` with `kind/title/detail/retryable`.
2. Caller-controlled `target_expiry_height` lands bit-exact on `nExpiryHeight` in the broadcast bytes.
3. A revoked or replayed `jti` is rejected before any signing work.
4. A spend that the wallet would not survive on chain (insufficient balance, stale anchor, expired tip) fails fast with a typed error and does not hit `/settle`.

## 6. References

- Proposal-0003 (zpay): the source of truth for D-1–D-15 and Phases 1–8.
- ADR-0001 in zally: zinder-only chain source.
- ADR-0002 in zpay: constrained signer / constrained broadcaster split.
- [`docs/findings/2026-06-08-pczt-updater-sighash.md`](../findings/2026-06-08-pczt-updater-sighash.md): the IoFinalizer + `dummy_sk` root cause that drove the `target_expiry_height` upstream patch.
- [librustzcash#2412](https://github.com/zcash/librustzcash/pull/2412): the upstream PR that makes `[patch.crates-io]` removable.
- [zexplorer.app](https://zexplorer.app): the explorer used to verify mined state.

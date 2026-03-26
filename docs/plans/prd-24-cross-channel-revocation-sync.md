# PRD-24: Cross-Channel Revocation Sync

## Problem Statement

When a user calls `revokeIdentity()` directly on the IdentityRegistry contract, the web app's database is never updated. The user's dashboard still shows them as verified, OID4VCI credentials remain active, and relying parties are not notified. The revocation is invisible to everything except the blockchain.

The reverse path also has gaps: when the server revokes on-chain via `revokeIdentityFor`, it marks the DB row `"revoked"` immediately without waiting for block confirmation. Failed on-chain revocations (`revocation_pending`) require manual admin intervention — there is no automated retry.

Additionally, identity revocation never triggers backchannel logout to connected relying parties. RPs holding valid access tokens for a revoked user continue to receive identity claims until the tokens expire naturally.

## Solution

An event indexer that polls `IdentityRevoked` events from the IdentityRegistry contract and cascades the revocation through the server's existing `revokeIdentity()` pipeline. A periodic cron route drives the polling and also retries any stuck `revocation_pending` attestations.

## User Stories

1. As a user who revoked my identity on-chain via a block explorer or wallet, I want my dashboard to reflect the revocation within 60 seconds, so that the system state is consistent.
2. As a user who self-revoked on-chain, I want my OID4VCI credentials to be marked revoked, so that relying parties can no longer verify them.
3. As a relying party with an active session for a user whose identity was just revoked, I want to receive a backchannel logout token, so that I can terminate the session.
4. As a relying party with a pending CIBA request for a revoked user, I want the request to be automatically denied, so that I don't grant access to a revoked identity.
5. As an admin, I want failed on-chain revocations to be retried automatically, so that I don't have to manually trigger reconciliation.
6. As a user who re-attests after revocation, I want the indexer to distinguish my new attestation from the revocation event, so that my fresh attestation is not incorrectly cascade-revoked.
7. As the system, I want the indexer to be idempotent, so that reprocessing the same block range does not create duplicate revocations or side effects.
8. As an operator, I want to see the last indexed block in the database, so that I can monitor indexer health and detect if it falls behind.

## Implementation Decisions

### Event Indexer

- Poll `IdentityRevoked(address indexed user)` events from the IdentityRegistry contract using `getLogs` with a block range.
- Track `lastIndexedBlock` in a new `indexer_state` table (single row per network, stores block number and timestamp).
- On each poll: fetch events from `lastIndexedBlock + 1` to `latestBlock`, process each event, advance the cursor.
- Chunk large ranges (e.g., max 2000 blocks per query) to avoid RPC timeouts.

### Revocation Cascade

- For each `IdentityRevoked` event, look up the user by wallet address in `blockchain_attestations`.
- Skip if: no matching user, already revoked in DB, or the user has a newer attestation (attestation timestamp > event block timestamp — handles re-attestation race).
- If the user exists and is not already revoked: call the existing `revokeIdentity(userId, "on-chain", "On-chain revocation detected")` which handles the full DB cascade (verifications, bundles, credentials, push subscriptions).

### Backchannel Logout on Revocation

- After `revokeIdentity()` completes, call `sendBackchannelLogout(userId)` to notify all connected RPs.
- Call `revokePendingCibaOnLogout(userId)` to cancel pending CIBA authorization requests.
- These calls are best-effort — failures are logged but do not block the cascade.

### Cron Route

- `POST /api/cron/revocation-sync` — authenticated with `INTERNAL_SERVICE_TOKEN` or a cron secret.
- Idempotent: reads `lastIndexedBlock` from DB, polls events, processes, advances cursor.
- Also calls `reconcilePendingRevocations()` to retry stuck on-chain revocations.
- Designed for Railway cron (HTTP trigger) or external scheduler hitting the endpoint.
- Target interval: every 30–60 seconds.

### Distinguishing User vs Registrar Revocations

- The `IdentityRevoked` event does not include who initiated the revocation.
- To distinguish: check if the transaction sender (`tx.from`) matches the registrar address. If yes, it's registrar-initiated (already handled server-side, skip cascade). If no, it's user-initiated (needs cascade).
- Alternative: always run the cascade but make it idempotent — if the DB is already revoked, the cascade is a no-op.

### Schema Changes

- New `indexer_state` table: `id` (text PK, e.g., "revocation-sepolia"), `networkId` (text), `lastIndexedBlock` (integer), `updatedAt` (text ISO timestamp).

## Testing Decisions

- **Unit tests** for the event processing logic: given a set of `IdentityRevoked` logs and DB state, verify correct cascade decisions (skip already-revoked, skip re-attested, cascade new revocations).
- **Unit tests** for idempotency: processing the same event twice produces no duplicate side effects.
- **Integration test**: deploy contract on Hardhat, attest, call `revokeIdentity()` on-chain, run the indexer, verify DB state changes (verification revoked, credentials revoked, attestation status updated).
- Follow the existing test patterns in `src/lib/db/queries/__tests__/` and `src/lib/trpc/routers/__tests__/`.

## Out of Scope

- Real-time WebSocket event subscription (polling is sufficient at 30–60s intervals).
- Indexing `IdentityAttested` events (attestation confirmation is already handled by the existing `recordSubmission` + polling flow).
- Multi-chain indexing (Sepolia only for now; Hardhat uses mock flow).
- On-chain revocation confirmation polling (the current fire-and-forget + retry is adequate).

## Further Notes

- The `revokeIdentity()` DB function is already idempotent for the DB cascade — re-revoking an already-revoked user is a no-op for steps 1–3. Step 4 (on-chain revocation) would be skipped if status is already `"revoked"`.
- The backchannel logout gap exists today for ALL revocation paths (admin, self-revoke, on-chain). Wiring it into `revokeIdentity()` itself (rather than just the indexer) would close the gap for all callers.
- The `reconcilePendingRevocations()` function already exists with exponential backoff and max 3 retries. The cron route simply triggers it periodically instead of requiring manual admin action.

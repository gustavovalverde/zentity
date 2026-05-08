import "server-only";

import { getEnabledNetworks } from "@/lib/blockchain/networks";
import { logError } from "@/lib/logging/error-logger";
import { logger } from "@/lib/logging/logger";

import { ingestChainValidityEvents } from "./chain-ingest";
import { deliverPendingValidityDeliveries } from "./delivery";
import { markDueIdentitiesStale } from "./freshness-worker";

/**
 * In-process scheduler for the validity-event pipeline.
 *
 * Runs on a fixed interval inside the long-lived Next.js server process
 * (Railway numReplicas=1). Three cold-path concerns ride here:
 *
 * - drain pending {@link deliverPendingValidityDeliveries}: retry rows that
 *   the inline drain in `recordValidityTransition` left in `retrying`/`pending`
 *   state (e.g., a Base Sepolia RPC blip during the user's polling request).
 * - {@link ingestChainValidityEvents} per enabled chain network: catches
 *   `IdentityAttested`/`IdentityRevoked` events recorded by the registrar
 *   out-of-band from the dashboard polling path.
 * - {@link markDueIdentitiesStale}: emits `stale` transitions for bundles
 *   whose verification expiry passed.
 *
 * This is the only background driver. The HTTP admin endpoints in
 * `app/api/internal/validity/*` remain available for manual debug or backfill
 * but are no longer load-bearing.
 */
const TICK_INTERVAL_MS = 60_000;

const SCHEDULER_STARTED_KEY = Symbol.for("zentity.validity.scheduler.started");

interface SchedulerState {
  started: boolean;
  timer?: NodeJS.Timeout;
}

function getSchedulerState(): SchedulerState {
  const scope = globalThis as unknown as Record<symbol, SchedulerState>;
  scope[SCHEDULER_STARTED_KEY] ??= { started: false };
  return scope[SCHEDULER_STARTED_KEY];
}

export function startScheduler(): void {
  if (process.env.VITEST_WORKER_ID || process.env.NODE_ENV === "test") {
    return;
  }

  const state = getSchedulerState();
  if (state.started) {
    return;
  }
  state.started = true;

  logger.info({ intervalMs: TICK_INTERVAL_MS }, "validity scheduler starting");

  // Errors are caught per-worker inside runTick so a single chain RPC
  // outage doesn't stop the others, and the next tick retries naturally.
  // The .catch() makes the promise non-floating per noFloatingPromises.
  state.timer = setInterval(() => {
    runTick().catch((error: unknown) => {
      logError(error, { path: "validity.scheduler.tick" });
    });
  }, TICK_INTERVAL_MS);

  // Keep Node alive while the scheduler runs but don't block fast shutdown
  // if everything else has exited.
  state.timer.unref?.();
}

async function runTick(): Promise<void> {
  await Promise.allSettled([
    drainDeliveries(),
    ingestEnabledChainNetworks(),
    runFreshnessSweep(),
  ]);
}

async function drainDeliveries(): Promise<void> {
  try {
    await deliverPendingValidityDeliveries();
  } catch (error) {
    logError(error, { path: "validity.scheduler.drain" });
  }
}

async function ingestEnabledChainNetworks(): Promise<void> {
  const chainNetworks = getEnabledNetworks().filter(
    (network) => network.chainId === 11_155_111 || network.chainId === 31_337
  );

  for (const network of chainNetworks) {
    try {
      await ingestChainValidityEvents({ networkId: network.id });
    } catch (error) {
      if (isConnectionRefused(error)) {
        // RPC isn't listening — common in dev when the local Hardhat node
        // isn't running. The next tick will pick it up if it comes back.
        logger.debug(
          { networkId: network.id },
          "validity scheduler: chain RPC unreachable, skipping"
        );
        continue;
      }
      logError(error, {
        path: "validity.scheduler.chain-ingest",
        operation: network.id,
      });
    }
  }
}

function isConnectionRefused(error: unknown): boolean {
  let cursor: unknown = error;
  while (cursor) {
    if (
      typeof cursor === "object" &&
      cursor !== null &&
      "code" in cursor &&
      (cursor as { code: unknown }).code === "ECONNREFUSED"
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

async function runFreshnessSweep(): Promise<void> {
  try {
    await markDueIdentitiesStale();
  } catch (error) {
    logError(error, { path: "validity.scheduler.freshness" });
  }
}

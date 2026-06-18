/**
 * Trust-boundary wire probe (PRD-43 Slice 1).
 *
 * Drives a valid DPoP-bound `at+jwt` through the real wallet
 * `POST /v1/payments/sign`, forwards the signed bytes to zpay `/settle`, and
 * broadcasts on testnet. Proves the wallet's verifier chain accepts a
 * conformant token and signs only under it.
 *
 * The token is minted by `@zentity/sdk/testing`'s `mintPaymentAuthorizationToken`
 * — the same conformant shape the zentity issuer produces — standing in for the
 * live CIBA mint until the BFF orchestrator drives it (PRD-43 Phase 3). The
 * DPoP key, the wallet call, and `/settle` all use ONE seed-derived key
 * (`@zentity/sdk/rp` `createDpopClientFromSeed`), so the token's `cnf.jkt`
 * matches the wallet proof (one `jkt` across the chain).
 *
 * Sequence (run twice, restarting the wallet between, since it loads the JWKS
 * at boot):
 *   1. pnpm --filter @zentity/demo-rp exec tsx scripts/probe-wire.mts   # writes JWKS
 *   2. restart zspend with ZSPEND_JWKS_FILE + ZSPEND_AUDIENCE set
 *   3. pnpm --filter @zentity/demo-rp exec tsx scripts/probe-wire.mts   # asserts
 *
 * Env:
 *   ZPAY_URL, ZSPEND_URL, ZPAY_PAYEE_ID, ZPAY_DPOP_KEY_SEED
 *   ZSPEND_JWKS_FILE           default /tmp/zspend-local/issuer-jwks.json
 *   ZSPEND_AUDIENCE            default "urn:zentity:wallet:zspend-demo"
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  type PaymentAuthorization,
  paymentUriToCaip10,
  SignedPayloadSchema,
} from "@zentity/sdk/protocol";
import {
  createDpopClientFromSeed,
  createWalletSpendRequest,
} from "@zentity/sdk/rp";
import {
  mintPaymentAuthorizationToken,
  paymentAuthorizationIssuerJwks,
} from "@zentity/sdk/testing";
import { calculateJwkThumbprint, type JWK } from "jose";

const ZPAY_URL = process.env.ZPAY_URL ?? "http://127.0.0.1:8080";
const ZSPEND_URL = process.env.ZSPEND_URL ?? "http://127.0.0.1:8090";
const ZPAY_PAYEE_ID = process.env.ZPAY_PAYEE_ID ?? "aether-demo";
const ZPAY_DPOP_KEY_SEED =
  process.env.ZPAY_DPOP_KEY_SEED ??
  "dev-only-aether-bff-dpop-seed-do-not-use-in-prod-stable-48chars";
const JWKS_FILE =
  process.env.ZSPEND_JWKS_FILE ?? "/tmp/zspend-local/issuer-jwks.json";
const AUDIENCE =
  process.env.ZSPEND_AUDIENCE ?? "urn:zentity:wallet:zspend-demo";

const AUTH_REJECTION_KINDS = new Set([
  "access_token_invalid",
  "dpop_proof_invalid",
  "audience_mismatch",
  "intent_mismatch",
  "recipient_mismatch",
  "token_revoked",
  "token_already_consumed",
]);

function log(kind: "PASS" | "FAIL" | "INFO" | "WARN", line: string): void {
  const prefix = { PASS: "✓", FAIL: "✗", INFO: "·", WARN: "!" }[kind];
  process.stdout.write(`${prefix} ${kind.padEnd(4)} ${line}\n`);
}
function bail(line: string): never {
  log("FAIL", line);
  process.exit(1);
}
function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

interface PreparedPayment {
  amount_zat: number;
  expiry_height: number;
  payment_id: string;
  payment_uri: string;
}

async function main(): Promise<void> {
  // Write the fixture issuer JWKS the wallet loads (kid matches the minter).
  mkdirSync(dirname(JWKS_FILE), { recursive: true });
  writeFileSync(
    JWKS_FILE,
    JSON.stringify(paymentAuthorizationIssuerJwks(), null, 2)
  );
  log("INFO", `issuer JWKS written → ${JWKS_FILE}`);

  const ready = await fetch(`${ZSPEND_URL}/readyz`).catch(() => null);
  if (!ready?.ok) {
    log(
      "WARN",
      "zspend /readyz not OK; if you just wrote the JWKS, restart the wallet then re-run"
    );
  }

  // One seed-derived DPoP key binds prepare, sign, and settle.
  const dpopClient = await createDpopClientFromSeed(ZPAY_DPOP_KEY_SEED);
  const jkt = await calculateJwkThumbprint(
    dpopClient.keyPair.publicJwk as JWK,
    "sha256"
  );
  log("PASS", `DPoP jkt = ${jkt}`);

  // /prepare for a real recipient/amount/expiry.
  const idem = base64url(
    createHash("sha256").update(`probe-wire:${Date.now()}`).digest()
  );
  const prepareUrl = `${ZPAY_URL}/x402/v2/prepare`;
  const prepRes = await fetch(prepareUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      DPoP: await dpopClient.proofFor("POST", prepareUrl),
    },
    body: JSON.stringify({
      payee_id: ZPAY_PAYEE_ID,
      network: "testnet",
      scheme: "zcash",
      resource_uri: "probe/items/coffee",
      nonce: idem,
      idempotency_key: idem,
    }),
  });
  if (!prepRes.ok) {
    bail(
      `/prepare → ${prepRes.status} ${(await prepRes.text()).slice(0, 200)}`
    );
  }
  const prepared = (await prepRes.json()) as PreparedPayment;
  log(
    "PASS",
    `prepare → payment_id=${prepared.payment_id} amount_zat=${prepared.amount_zat} expiry=${prepared.expiry_height}`
  );

  // Build the canonical RAR + intent_hash over the parsed tuple.
  const reference = networkToChainReference("testnet");
  const recipient = paymentUriToCaip10(prepared.payment_uri, reference);
  const intentWire = intentHashToWireString(
    intentHash({
      chainNamespace: "zcash",
      chainReference: reference,
      recipientCaip10: recipient,
      amountValue: BigInt(prepared.amount_zat),
      amountUnit: "base",
      paymentId: prepared.payment_id,
      expiryHeight: BigInt(prepared.expiry_height),
    })
  );
  const rar: PaymentAuthorization = {
    type: "payment_authorization",
    chain: { namespace: "zcash", reference },
    recipient,
    amount: {
      currency: "ZEC",
      value: String(prepared.amount_zat),
      unit: "base",
    },
    payment_id: prepared.payment_id,
    intent_hash: intentWire,
    expires_at: { kind: "block_height", value: prepared.expiry_height },
  };

  // Mint the conformant at+jwt (cnf.jkt = the seed DPoP key).
  const accessToken = await mintPaymentAuthorizationToken({
    authorization: rar,
    audience: AUDIENCE,
    dpopJkt: jkt,
  });
  log("INFO", `minted at+jwt (aud=${AUDIENCE}, cnf.jkt=${jkt})`);

  const signUrl = `${ZSPEND_URL}/v1/payments/sign`;
  const spend = await createWalletSpendRequest({
    accessToken,
    dpopClient,
    walletEndpoint: signUrl,
    paymentRequest: { scheme: "zip321", value: prepared.payment_uri },
    paymentId: prepared.payment_id,
    targetExpiryHeight: prepared.expiry_height,
    network: "testnet",
  });

  const signRes = await fetch(signUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...spend.headers },
    body: JSON.stringify(spend.body),
  });
  const signText = await signRes.text();
  if (!signRes.ok) {
    const kind = (JSON.parse(signText) as { kind?: string }).kind ?? "?";
    if (AUTH_REJECTION_KINDS.has(kind)) {
      bail(
        `/sign REJECTED a valid token at the gate → ${signRes.status} ${kind}: ${signText.slice(0, 200)}`
      );
    }
    // A funds/chain failure AFTER the verifiers admit the token still proves
    // the boundary accepted it.
    log(
      "PASS",
      `/sign accepted the token (passed all verifiers); post-verify failure → ${signRes.status} ${kind}`
    );
    log("INFO", `detail: ${signText.slice(0, 300)}`);
    return;
  }

  const parsed = SignedPayloadSchema.parse(
    (JSON.parse(signText) as { signed_payload: unknown }).signed_payload
  );
  log(
    "PASS",
    `/sign ACCEPTED valid token → 200; tx_id=${parsed.tx_id} format=${parsed.format}`
  );

  // Forward to zpay /settle to broadcast on testnet.
  const settleUrl = `${ZPAY_URL}/x402/v2/settle`;
  const settleRes = await fetch(settleUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      DPoP: await dpopClient.proofFor("POST", settleUrl),
    },
    body: JSON.stringify({
      payment_id: prepared.payment_id,
      raw_tx_hex: Buffer.from(parsed.bytes, "base64").toString("hex"),
    }),
  });
  const settleText = await settleRes.text();
  if (!settleRes.ok) {
    log("WARN", `/settle → ${settleRes.status} ${settleText.slice(0, 300)}`);
    return;
  }
  const settlement = JSON.parse(settleText) as {
    broadcast_outcome?: { kind?: string; transaction_id?: string };
  };
  const outcome = settlement.broadcast_outcome;
  log("PASS", `/settle → 200; broadcast kind=${outcome?.kind ?? "?"}`);
  if (outcome?.transaction_id) {
    log(
      "INFO",
      `explorer: https://zexplorer.app/testnet/tx/${outcome.transaction_id}`
    );
  }
  log("INFO", "probe-wire complete");
}

main().catch((err) => {
  log("FAIL", `unhandled: ${(err as Error).stack ?? err}`);
  process.exit(1);
});

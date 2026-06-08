/**
 * Black-box probe of the Aether agent-bound wallet wire (Proposal-0003).
 *
 * Walks the request chain as far as it can go without a browser session,
 * a funded test wallet, or a real lightwalletd. Each step prints PASS or
 * FAIL and tails the relevant detail. Exits non-zero on the first
 * actionable failure so CI can gate on it.
 *
 * Run from the repo root or apps/demo-rp:
 *   pnpm --filter @zentity/demo-rp exec tsx scripts/probe-e2e.mts
 *
 * Required env:
 *   ZPAY_URL              default http://127.0.0.1:8080
 *   ZSPEND_URL            default http://127.0.0.1:8090
 *   ZPAY_PAYEE_ID         default aether-demo
 *   ZPAY_DPOP_KEY_SEED    must match the value set in zpay docker-compose
 *                         (default dev-only-aether-bff-dpop-seed-do-not-use-in-prod-stable-48chars)
 */

import { createHash, hkdfSync, randomUUID } from "node:crypto";
import { p256 } from "@noble/curves/p256";
import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  PaymentAuthorizationDetailsSchema,
  paymentUriToCaip10,
} from "@zentity/sdk/protocol";
import {
  type CryptoKey,
  calculateJwkThumbprint,
  importJWK,
  type JWK,
  SignJWT,
} from "jose";

const ZPAY_URL = process.env.ZPAY_URL ?? "http://127.0.0.1:8080";
const ZSPEND_URL = process.env.ZSPEND_URL ?? "http://127.0.0.1:8090";
const ZPAY_PAYEE_ID = process.env.ZPAY_PAYEE_ID ?? "aether-demo";
const ZPAY_DPOP_KEY_SEED =
  process.env.ZPAY_DPOP_KEY_SEED ??
  "dev-only-aether-bff-dpop-seed-do-not-use-in-prod-stable-48chars";

function log(kind: "PASS" | "FAIL" | "INFO" | "WARN", line: string): void {
  const prefix = { PASS: "✓", FAIL: "✗", INFO: "·", WARN: "!" }[kind];
  process.stdout.write(`${prefix} ${kind.padEnd(4)} ${line}\n`);
}

function bail(line: string): never {
  log("FAIL", line);
  process.exit(1);
}

async function deriveDpop(): Promise<{
  jkt: string;
  jwk: JWK;
  privateKey: CryptoKey;
}> {
  const seed = new TextEncoder().encode(ZPAY_DPOP_KEY_SEED);
  const stretched = hkdfSync(
    "sha256",
    seed,
    new TextEncoder().encode("zpay-dpop-key-v1"),
    "zpay/v1/dpop",
    32
  );
  const order = p256.CURVE.n;
  const scalarRaw = BigInt(`0x${Buffer.from(stretched).toString("hex")}`);
  const scalar = scalarRaw % order === 0n ? 1n : scalarRaw % order;
  const privateScalar = Buffer.from(
    scalar.toString(16).padStart(64, "0"),
    "hex"
  );
  const point = p256.Point.fromPrivateKey(privateScalar);
  const { x, y } = point.toAffine();
  const xB64 = base64url(Buffer.from(x.toString(16).padStart(64, "0"), "hex"));
  const yB64 = base64url(Buffer.from(y.toString(16).padStart(64, "0"), "hex"));
  const privateJwk: JWK = {
    kty: "EC",
    crv: "P-256",
    d: base64url(privateScalar),
    x: xB64,
    y: yB64,
  };
  const jwk: JWK = { kty: "EC", crv: "P-256", x: xB64, y: yB64 };
  const privateKey = (await importJWK(privateJwk, "ES256")) as CryptoKey;
  const jkt = await calculateJwkThumbprint(jwk, "sha256");
  return { jkt, jwk, privateKey };
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signDpop(
  method: string,
  url: string,
  jwk: JWK,
  privateKey: CryptoKey
): Promise<string> {
  return new SignJWT({
    htm: method,
    htu: url,
    jti: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
    .sign(privateKey);
}

async function probe(label: string, url: string): Promise<Response | null> {
  try {
    const r = await fetch(url);
    log(r.ok ? "PASS" : "FAIL", `${label} → ${r.status} ${url}`);
    return r;
  } catch (err) {
    log("FAIL", `${label} → ${(err as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  log("INFO", `ZPAY_URL    = ${ZPAY_URL}`);
  log("INFO", `ZSPEND_URL  = ${ZSPEND_URL}`);
  log("INFO", `ZPAY_PAYEE  = ${ZPAY_PAYEE_ID}`);

  // 1. zpay liveness
  const zpayHealth = await probe("zpay /healthz", `${ZPAY_URL}/healthz`);
  if (!zpayHealth?.ok) {
    bail("zpay is not alive; check docker compose ps");
  }

  // 2. zspend-runtime liveness
  const zspendReady = await probe("zspend /readyz", `${ZSPEND_URL}/readyz`);
  if (!zspendReady?.ok) {
    log(
      "WARN",
      "zspend-runtime not ready — wire walk continues but /sign will fail"
    );
  }

  // 3. Mint a DPoP proof for /prepare
  log("INFO", "deriving DPoP key material from ZPAY_DPOP_KEY_SEED");
  const dpop = await deriveDpop();
  log("PASS", `DPoP jkt = ${dpop.jkt}`);

  // 4. POST /x402/v2/prepare
  const prepareUrl = `${ZPAY_URL}/x402/v2/prepare`;
  const idemSource = `probe:${ZPAY_PAYEE_ID}:${Date.now()}`;
  const idempotencyKey = base64url(
    createHash("sha256").update(idemSource).digest()
  );
  const nonce = idempotencyKey;
  const prepareBody = {
    payee_id: ZPAY_PAYEE_ID,
    network: "testnet" as const,
    scheme: "zcash" as const,
    resource_uri: "probe/items/coffee",
    nonce,
    idempotency_key: idempotencyKey,
  };
  const prepareProof = await signDpop(
    "POST",
    prepareUrl,
    dpop.jwk,
    dpop.privateKey
  );
  let prepared: {
    amount_zat: number;
    expiry_height: number;
    payment_id: string;
    payment_uri: string;
  } | null = null;
  try {
    const r = await fetch(prepareUrl, {
      method: "POST",
      headers: { "content-type": "application/json", DPoP: prepareProof },
      body: JSON.stringify(prepareBody),
    });
    const text = await r.text();
    if (!r.ok) {
      log("FAIL", `zpay /x402/v2/prepare → ${r.status} ${text.slice(0, 200)}`);
      bail("prepare failed; cannot continue without a payment_id");
    }
    prepared = JSON.parse(text);
    log(
      "PASS",
      `prepare → payment_id=${prepared?.payment_id} amount_zat=${prepared?.amount_zat}`
    );
    log("INFO", `prepare → payment_uri=${prepared?.payment_uri?.slice(0, 80)}`);
    log("INFO", `prepare → expiry_height=${prepared?.expiry_height}`);
  } catch (err) {
    bail(`prepare exception: ${(err as Error).message}`);
  }
  if (!prepared) {
    bail("prepared payload missing");
  }

  // 5. Build canonical payment_authorization RAR
  const chainReference = networkToChainReference("testnet");
  const recipient = paymentUriToCaip10(prepared.payment_uri, chainReference);
  const intentHashWire = intentHashToWireString(
    intentHash({
      chainNamespace: "zcash",
      chainReference,
      recipientCaip10: recipient,
      amountValue: BigInt(prepared.amount_zat),
      amountUnit: "base",
      paymentId: prepared.payment_id,
      expiryHeight: BigInt(prepared.expiry_height),
    })
  );
  const rar = {
    type: "payment_authorization" as const,
    chain: { namespace: "zcash" as const, reference: chainReference },
    recipient,
    amount: {
      currency: "ZEC",
      value: String(prepared.amount_zat),
      unit: "base" as const,
    },
    payment_id: prepared.payment_id,
    intent_hash: intentHashWire,
    expires_at: {
      kind: "block_height" as const,
      value: prepared.expiry_height,
    },
  };
  try {
    PaymentAuthorizationDetailsSchema.parse([rar]);
    log("PASS", `RAR parses; recipient=${recipient}`);
    log("INFO", `RAR intent_hash=${intentHashWire}`);
  } catch (err) {
    log("FAIL", `RAR did not parse: ${(err as Error).message}`);
    bail("schema mismatch — wire break between BFF and issuer");
  }

  // 6. POST zspend-runtime /v1/payments/sign
  if (!zspendReady?.ok) {
    log("INFO", "probe complete (zspend unreachable)");
    return;
  }

  const signUrl = `${ZSPEND_URL}/v1/payments/sign`;
  const signBody = {
    payment_request: { scheme: "zip321", value: prepared.payment_uri },
    network: "testnet",
    payment_id: prepared.payment_id,
    target_expiry_height: prepared.expiry_height,
  };
  let signedBytesBase64: string | null = null;
  try {
    const r = await fetch(signUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signBody),
    });
    const text = await r.text();
    if (!r.ok) {
      log(
        "WARN",
        `zspend /v1/payments/sign → ${r.status} ${text.slice(0, 200)}`
      );
      log("INFO", "probe complete (sign step failed)");
      return;
    }
    log("PASS", "zspend /v1/payments/sign → 200");
    const body = JSON.parse(text) as {
      signed_payload?: { bytes?: string; tx_id?: string; fee?: string };
    };
    signedBytesBase64 = body?.signed_payload?.bytes ?? null;
    log("INFO", `signed_payload.tx_id=${body?.signed_payload?.tx_id ?? "?"}`);
    log("INFO", `signed_payload.fee=${body?.signed_payload?.fee ?? "?"}`);
  } catch (err) {
    log("FAIL", `zspend exception: ${(err as Error).message}`);
    return;
  }

  if (!signedBytesBase64) {
    log("FAIL", "no signed_payload.bytes in zspend response");
    return;
  }

  // 7. POST zpay /x402/v2/settle with the signed bytes
  const rawTxHex = Buffer.from(signedBytesBase64, "base64").toString("hex");
  const settleUrl = `${ZPAY_URL}/x402/v2/settle`;
  const settleProof = await signDpop(
    "POST",
    settleUrl,
    dpop.jwk,
    dpop.privateKey
  );
  try {
    const r = await fetch(settleUrl, {
      method: "POST",
      headers: { "content-type": "application/json", DPoP: settleProof },
      body: JSON.stringify({
        payment_id: prepared.payment_id,
        raw_tx_hex: rawTxHex,
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      log("FAIL", `zpay /x402/v2/settle → ${r.status} ${text.slice(0, 300)}`);
      return;
    }
    const settlement = JSON.parse(text) as {
      payment_id: string;
      broadcast_outcome?: {
        kind?: string;
        transaction_id?: string;
        upstream_message?: string;
      };
    };
    const outcome = settlement.broadcast_outcome;
    log("PASS", "zpay /x402/v2/settle → 200");
    log("INFO", `broadcast_outcome.kind=${outcome?.kind ?? "?"}`);
    log(
      "INFO",
      `broadcast_outcome.transaction_id=${outcome?.transaction_id ?? "(none)"}`
    );
    if (outcome?.upstream_message) {
      log(
        "INFO",
        `broadcast_outcome.upstream_message=${outcome.upstream_message}`
      );
    }
  } catch (err) {
    log("FAIL", `settle exception: ${(err as Error).message}`);
    return;
  }

  log("INFO", "probe complete");
}

main().catch((err) => {
  log("FAIL", `unhandled: ${(err as Error).stack ?? err}`);
  process.exit(1);
});

/**
 * Trust-boundary spoof probe (PRD-43 Slice 1).
 *
 * Asserts each negative path at the wallet `POST /v1/payments/sign` returns
 * its typed `kind` BEFORE any signing work — proving the verifier chain
 * rejects bad inputs without touching the wallet. Run after `probe-wire.mts`
 * has written the issuer JWKS and the wallet has been restarted.
 *
 * Covers the verifier-rejection paths (no funded wallet needed):
 *   - wrong audience            → audience_mismatch
 *   - tampered access token     → access_token_invalid
 *   - DPoP proof / token mismatch (ath) → dpop_proof_invalid
 *   - mutated payment amount    → intent_mismatch
 *
 * The stateful kinds (token_already_consumed on a same-jti replay,
 * token_revoked) are covered by zpay unit tests (zspend-runtime), since they
 * need a committed signature / the live issuer revocation feed.
 *
 * Env: same as probe-wire.mts.
 */

import { createHash } from "node:crypto";
import {
  intentHash,
  intentHashToWireString,
  networkToChainReference,
  type PaymentAuthorization,
  paymentUriToCaip10,
} from "@zentity/sdk/protocol";
import {
  createDpopClientFromSeed,
  createWalletSpendRequest,
} from "@zentity/sdk/rp";
import { mintPaymentAuthorizationToken } from "@zentity/sdk/testing";
import { calculateJwkThumbprint, type JWK } from "jose";

const ZPAY_URL = process.env.ZPAY_URL ?? "http://127.0.0.1:8080";
const ZSPEND_URL = process.env.ZSPEND_URL ?? "http://127.0.0.1:8090";
const ZPAY_PAYEE_ID = process.env.ZPAY_PAYEE_ID ?? "aether-demo";
const ZPAY_DPOP_KEY_SEED =
  process.env.ZPAY_DPOP_KEY_SEED ??
  "dev-only-aether-bff-dpop-seed-do-not-use-in-prod-stable-48chars";
const AUDIENCE =
  process.env.ZSPEND_AUDIENCE ?? "urn:zentity:wallet:zspend-demo";
const SPOOF_AMOUNT_RE = /amount=[0-9.]+/;

let failures = 0;
function log(kind: "PASS" | "FAIL" | "INFO", line: string): void {
  const prefix = { PASS: "✓", FAIL: "✗", INFO: "·" }[kind];
  process.stdout.write(`${prefix} ${kind.padEnd(4)} ${line}\n`);
}
function expectKind(
  label: string,
  status: number,
  body: string,
  kind: string
): void {
  const got = (JSON.parse(body) as { kind?: string }).kind ?? "?";
  if (got === kind) {
    log("PASS", `${label} → ${status} ${got}`);
  } else {
    failures += 1;
    log(
      "FAIL",
      `${label} → expected ${kind}, got ${status} ${got}: ${body.slice(0, 160)}`
    );
  }
}

const SIGN_URL = `${ZSPEND_URL}/v1/payments/sign`;

async function signWith(
  accessToken: string,
  dpopProof: string,
  body: unknown
): Promise<{ status: number; text: string }> {
  const res = await fetch(SIGN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `DPoP ${accessToken}`,
      dpop: dpopProof,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function main(): Promise<void> {
  const dpopClient = await createDpopClientFromSeed(ZPAY_DPOP_KEY_SEED);
  const jkt = await calculateJwkThumbprint(
    dpopClient.keyPair.publicJwk as JWK,
    "sha256"
  );

  const idem = createHash("sha256")
    .update(`probe-spoof:${Date.now()}`)
    .digest("base64url");
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
    log(
      "FAIL",
      `/prepare → ${prepRes.status} ${(await prepRes.text()).slice(0, 200)}`
    );
    process.exit(1);
  }
  const prepared = (await prepRes.json()) as {
    amount_zat: number;
    expiry_height: number;
    payment_id: string;
    payment_uri: string;
  };

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

  const goodBody = {
    payment_request: { scheme: "zip321", value: prepared.payment_uri },
    network: "testnet",
    payment_id: prepared.payment_id,
    target_expiry_height: prepared.expiry_height,
  };

  // 1. Wrong audience → audience_mismatch.
  const wrongAud = await mintPaymentAuthorizationToken({
    authorization: rar,
    audience: "spoof-wrong-audience",
    dpopJkt: jkt,
  });
  const r1 = await signWith(
    wrongAud,
    await dpopClient.proofFor("POST", SIGN_URL, wrongAud),
    goodBody
  );
  expectKind("wrong audience", r1.status, r1.text, "audience_mismatch");

  // 2. Tampered access-token signature → access_token_invalid.
  const goodToken = await mintPaymentAuthorizationToken({
    authorization: rar,
    audience: AUDIENCE,
    dpopJkt: jkt,
  });
  const tampered = `${goodToken.slice(0, -3)}${goodToken.slice(-3) === "AAA" ? "BBB" : "AAA"}`;
  const r2 = await signWith(
    tampered,
    await dpopClient.proofFor("POST", SIGN_URL, tampered),
    goodBody
  );
  expectKind("tampered token", r2.status, r2.text, "access_token_invalid");

  // 3. DPoP proof bound to a DIFFERENT token (ath mismatch) → dpop_proof_invalid.
  const otherToken = await mintPaymentAuthorizationToken({
    authorization: rar,
    audience: AUDIENCE,
    dpopJkt: jkt,
  });
  const mismatchedProof = await dpopClient.proofFor(
    "POST",
    SIGN_URL,
    otherToken
  );
  const r3 = await signWith(goodToken, mismatchedProof, goodBody);
  expectKind("dpop ath mismatch", r3.status, r3.text, "dpop_proof_invalid");

  // 4. Mutated payment amount → recomputed intent diverges → intent_mismatch.
  const spoofUri = prepared.payment_uri.includes("amount=")
    ? prepared.payment_uri.replace(SPOOF_AMOUNT_RE, "amount=0.00001")
    : `${prepared.payment_uri}${prepared.payment_uri.includes("?") ? "&" : "?"}amount=0.00001`;
  const spend = await createWalletSpendRequest({
    accessToken: goodToken,
    dpopClient,
    walletEndpoint: SIGN_URL,
    paymentRequest: { scheme: "zip321", value: spoofUri },
    paymentId: prepared.payment_id,
    targetExpiryHeight: prepared.expiry_height,
    network: "testnet",
  });
  const r4 = await signWith(
    spend.headers.authorization.slice(5),
    spend.headers.dpop,
    spend.body
  );
  expectKind("mutated amount", r4.status, r4.text, "intent_mismatch");

  if (failures > 0) {
    log("FAIL", `probe-spoof: ${failures} path(s) returned the wrong kind`);
    process.exit(1);
  }
  log(
    "INFO",
    "probe-spoof complete: every negative path returned its kind before signing"
  );
}

main().catch((err) => {
  log("FAIL", `unhandled: ${(err as Error).stack ?? err}`);
  process.exit(1);
});

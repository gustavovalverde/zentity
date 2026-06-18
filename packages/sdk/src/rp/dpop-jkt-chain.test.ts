/**
 * One-`jkt` invariant across the payment channel (PRD-43 Open Question 3).
 *
 * The issuer pins `cnf.jkt` to the DPoP key that authenticated the token
 * request; the wallet then requires the inbound `/sign` proof to be signed by
 * that same key. This test walks the whole chain from one seed: derive the
 * key, compute its thumbprint, mint a token bound to it, assemble the wallet
 * request, and assert the proof header's key thumbprint equals the token's
 * `cnf.jkt`. A drift anywhere in the chain breaks the wallet binding.
 */

import {
	calculateJwkThumbprint,
	decodeJwt,
	decodeProtectedHeader,
	type JWK,
} from "jose";
import { describe, expect, it } from "vitest";

import type { PaymentAuthorization } from "../protocol";
import { mintPaymentAuthorizationToken } from "../testing/payment-token";
import {
	createDpopClientFromSeed,
	deriveDpopKeyPairFromSeed,
} from "./dpop-client";
import { createWalletSpendRequest } from "./wallet-spend";

const SEED = "dpop-jkt-chain-test-seed-stable-0123456789abcdef";

const RAR: PaymentAuthorization = {
	type: "payment_authorization",
	chain: { namespace: "zcash", reference: "test" },
	recipient: "zcash:test:utest1qq0",
	amount: { currency: "ZEC", value: "50000000", unit: "base" },
	payment_id: "pay_chain_1",
	intent_hash: `v1:sha256:${"A".repeat(43)}`,
	expires_at: { kind: "block_height", value: 4_056_276 },
};

describe("dpop jkt chain (seed -> cnf.jkt -> proof jwk)", () => {
	it("binds the wallet proof key to the token cnf.jkt from one seed", async () => {
		const keyPair = await deriveDpopKeyPairFromSeed(SEED);
		const jkt = await calculateJwkThumbprint(
			keyPair.publicJwk as JWK,
			"sha256",
		);

		const token = await mintPaymentAuthorizationToken({
			authorization: RAR,
			audience: "urn:zentity:wallet:test",
			dpopJkt: jkt,
		});

		const request = await createWalletSpendRequest({
			accessToken: token,
			dpopClient: await createDpopClientFromSeed(SEED),
			walletEndpoint: "https://wallet.test/v1/payments/sign",
			paymentRequest: { scheme: "zip321", value: "zcash:utest1qq0?amount=0.5" },
			paymentId: RAR.payment_id,
			targetExpiryHeight: 4_056_276,
			network: "testnet",
		});

		const proofJwk = decodeProtectedHeader(request.headers.dpop).jwk;
		if (!proofJwk) {
			throw new Error("DPoP proof header carried no embedded jwk");
		}
		const proofJkt = await calculateJwkThumbprint(proofJwk, "sha256");

		const tokenCnfJkt = (decodeJwt(token).cnf as { jkt: string }).jkt;
		expect(proofJkt).toBe(tokenCnfJkt);
		expect(proofJkt).toBe(jkt);
	});
});

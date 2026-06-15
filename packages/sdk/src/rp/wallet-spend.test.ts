import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";

import { createDpopClientFromSeed } from "./dpop-client";
import { createWalletSpendRequest } from "./wallet-spend";

describe("createWalletSpendRequest", () => {
	it("assembles DPoP-bound headers and the wallet body", async () => {
		const dpopClient = await createDpopClientFromSeed(
			"wallet-spend-test-seed-stable-0123456789",
		);
		const request = await createWalletSpendRequest({
			accessToken: "at.jwt.token",
			dpopClient,
			walletEndpoint: "https://wallet.test/v1/payments/sign",
			paymentRequest: { scheme: "zip321", value: "zcash:utest1qq0?amount=0.5" },
			paymentId: "pay_1",
			targetExpiryHeight: 4_056_276,
			network: "testnet",
		});

		expect(request.headers.authorization).toBe("DPoP at.jwt.token");
		expect(request.body).toEqual({
			network: "testnet",
			payment_id: "pay_1",
			payment_request: { scheme: "zip321", value: "zcash:utest1qq0?amount=0.5" },
			target_expiry_height: 4_056_276,
		});

		expect(decodeProtectedHeader(request.headers.dpop).typ).toBe("dpop+jwt");
		const proof = decodeJwt(request.headers.dpop);
		expect(proof.htm).toBe("POST");
		expect(proof.htu).toBe("https://wallet.test/v1/payments/sign");
		// `ath` binds the proof to this exact access token (RFC 9449).
		expect(proof.ath).toBeTruthy();
	});
});

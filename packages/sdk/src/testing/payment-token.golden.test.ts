/**
 * Cross-language golden `at+jwt` fixture (PRD-43 Slice 1, D-C).
 *
 * `__fixtures__/golden-payment-token.json` is the one committed token both
 * repos load: this test proves the SDK minter regenerates it byte-identical
 * and that `jwtVerify` accepts it against the committed JWKS, while zpay's
 * `zspend-core` deserializes the SAME JSON and runs its verifier over the
 * SAME token string. One minter, two repos.
 *
 * The token is time-independent: minting with `now = 4_102_444_680` and the
 * 120 s cap pins `exp = 4_102_444_800` (zpay's `FAR_FUTURE` constant, year
 * 2100), so a committed token verifies regardless of wall clock.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createLocalJWKSet, type JWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { intentHash, intentHashToWireString } from "../protocol/intent-hash";
import {
	mintPaymentAuthorizationToken,
	PAYMENT_TOKEN_ISSUER_KID,
	paymentAuthorizationIssuerJwks,
} from "./payment-token";

// These constants regenerate the committed fixture. They mirror zpay's
// `crates/zspend-core/src/access_token.rs` test vocabulary: `RECIPIENT`,
// amount `50000000` base, `WALLET_AUD`, and `FAR_FUTURE`. Changing any of
// them is a wire break: update the fixture JSON in lockstep on both repos.
const RECIPIENT = "zcash:test:utest1qq";
const CHAIN = { namespace: "zcash", reference: "test" } as const;
const AMOUNT_VALUE = "50000000";
const PAYMENT_ID = "01KT9A0V431VGD5YH7R7G635HC";
const EXPIRY_HEIGHT = 4_047_100;
const AUDIENCE = "urn:zentity:wallet:test";
const DPOP_JKT = "dpop-key-thumbprint";
const JTI = "01GOLDENACCESSTOKENJTI00000";
// now = FAR_FUTURE - 120, so exp lands exactly on zpay's FAR_FUTURE.
const NOW = 4_102_444_680;
const FAR_FUTURE = 4_102_444_800;

interface GoldenFixture {
	token: string;
	jwks: { keys: JWK[] };
	audience: string;
	expectedRecipient: string;
	expectedIntentHash: string;
	cnfJkt: string;
}

const fixture: GoldenFixture = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("./__fixtures__/golden-payment-token.json", import.meta.url),
		),
		"utf8",
	),
);

const expectedIntentHash = intentHashToWireString(
	intentHash({
		chainNamespace: CHAIN.namespace,
		chainReference: CHAIN.reference,
		recipientCaip10: RECIPIENT,
		amountValue: Number(AMOUNT_VALUE),
		amountUnit: "base",
		paymentId: PAYMENT_ID,
		expiryHeight: EXPIRY_HEIGHT,
	}),
);

function mintGolden(): Promise<string> {
	return mintPaymentAuthorizationToken({
		authorization: {
			type: "payment_authorization",
			chain: CHAIN,
			recipient: RECIPIENT,
			amount: { currency: "ZEC", value: AMOUNT_VALUE, unit: "base" },
			payment_id: PAYMENT_ID,
			intent_hash: expectedIntentHash,
			expires_at: { kind: "block_height", value: EXPIRY_HEIGHT },
		},
		audience: AUDIENCE,
		dpopJkt: DPOP_JKT,
		jti: JTI,
		now: NOW,
		expiresInSeconds: 120,
	});
}

describe("golden payment-authorization at+jwt", () => {
	it("regenerates the committed fixture byte-identical", async () => {
		const token = await mintGolden();
		expect(token).toBe(fixture.token);
		expect(fixture.expectedIntentHash).toBe(expectedIntentHash);
		expect(fixture.jwks).toEqual(paymentAuthorizationIssuerJwks());
		expect(fixture.audience).toBe(AUDIENCE);
		expect(fixture.expectedRecipient).toBe(RECIPIENT);
		expect(fixture.cnfJkt).toBe(DPOP_JKT);
	});

	it("verifies against the committed JWKS (minter<->JWKS kid/alg contract)", async () => {
		const jwks = createLocalJWKSet(fixture.jwks);
		const { payload, protectedHeader } = await jwtVerify(fixture.token, jwks);

		expect(protectedHeader.kid).toBe(PAYMENT_TOKEN_ISSUER_KID);
		expect(protectedHeader.alg).toBe("EdDSA");
		expect(protectedHeader.typ).toBe("at+jwt");

		expect(payload.aud).toBe(AUDIENCE);
		expect((payload.cnf as { jkt: string }).jkt).toBe(DPOP_JKT);
		expect(payload.exp).toBe(FAR_FUTURE);
		expect(payload.jti).toBe(JTI);

		const details = payload.authorization_details as Array<
			Record<string, unknown>
		>;
		expect(details).toHaveLength(1);
		expect(details[0]?.recipient).toBe(RECIPIENT);
		expect(details[0]?.intent_hash).toBe(expectedIntentHash);
	});

	it("rejects the token when verified against an unrelated JWKS", async () => {
		const foreign = paymentAuthorizationIssuerJwks();
		const wrongKey = foreign.keys[0];
		if (!wrongKey) {
			throw new Error("fixture JWKS missing its key");
		}
		// Swap the public point so the kid resolves but the signature cannot.
		const tampered = createLocalJWKSet({
			keys: [{ ...wrongKey, x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
		});
		await expect(jwtVerify(fixture.token, tampered)).rejects.toThrow();
	});
});

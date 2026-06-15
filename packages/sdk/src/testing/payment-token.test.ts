import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";

import {
	type PaymentAuthorization,
	PaymentAuthorizationDetailsSchema,
} from "../protocol";
import {
	mintPaymentAuthorizationToken,
	PAYMENT_TOKEN_ISSUER_KID,
	paymentAuthorizationIssuerJwks,
} from "./payment-token";

const RAR: PaymentAuthorization = {
	type: "payment_authorization",
	chain: { namespace: "zcash", reference: "test" },
	recipient: "zcash:test:utest1qq0",
	amount: { currency: "ZEC", value: "50000000", unit: "base" },
	payment_id: "pay_123",
	intent_hash: `v1:sha256:${"A".repeat(43)}`,
	expires_at: { kind: "block_height", value: 4_056_276 },
};

describe("mintPaymentAuthorizationToken", () => {
	it("mints a conformant at+jwt the wallet verifier expects", async () => {
		const token = await mintPaymentAuthorizationToken({
			authorization: RAR,
			audience: "wallet-jkt-thumbprint",
			dpopJkt: "bff-dpop-jkt",
		});
		const header = decodeProtectedHeader(token);
		expect(header.typ).toBe("at+jwt");
		expect(header.alg).toBe("EdDSA");
		expect(header.kid).toBe(PAYMENT_TOKEN_ISSUER_KID);

		const claims = decodeJwt(token);
		expect(claims.aud).toBe("wallet-jkt-thumbprint");
		expect((claims.cnf as { jkt: string }).jkt).toBe("bff-dpop-jkt");
		expect(claims.jti).toBeTruthy();
		expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBeLessThanOrEqual(120);
		const details = PaymentAuthorizationDetailsSchema.parse(
			claims.authorization_details,
		);
		expect(details[0]?.recipient).toBe(RAR.recipient);
		expect(details[0]?.intent_hash).toBe(RAR.intent_hash);
	});

	it("caps the lifetime at 120 seconds", async () => {
		const token = await mintPaymentAuthorizationToken({
			authorization: RAR,
			audience: "aud",
			dpopJkt: "jkt",
			expiresInSeconds: 3600,
		});
		const claims = decodeJwt(token);
		expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(120);
	});

	it("embeds act.sub when an actor is given", async () => {
		const token = await mintPaymentAuthorizationToken({
			authorization: RAR,
			audience: "aud",
			dpopJkt: "jkt",
			actorSub: "agent-pairwise-sub",
		});
		const claims = decodeJwt(token);
		expect((claims.act as { sub: string }).sub).toBe("agent-pairwise-sub");
	});

	it("rejects a malformed RAR before signing", async () => {
		await expect(
			mintPaymentAuthorizationToken({
				authorization: { ...RAR, intent_hash: "not-a-valid-hash" },
				audience: "aud",
				dpopJkt: "jkt",
			}),
		).rejects.toThrow();
	});

	it("serves a JWKS with the issuer kid for the wallet to load", () => {
		const jwks = paymentAuthorizationIssuerJwks();
		expect(jwks.keys).toHaveLength(1);
		expect(jwks.keys[0]?.kid).toBe(PAYMENT_TOKEN_ISSUER_KID);
		expect(jwks.keys[0]?.crv).toBe("Ed25519");
		expect(jwks.keys[0]?.alg).toBe("EdDSA");
	});
});

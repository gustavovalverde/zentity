import { describe, expect, it } from "vitest";
import { createProofOfHumanTokenVerifier } from "../rp/proof-of-human";
import { createOpenIdTokenVerifier } from "../rp/token-verifier";
import { fixtureKeys } from "./fixture-keys";
import { createMockIssuer } from "./mock-issuer";
import { mockMerchantPohToken, mockPohToken } from "./mock-poh-token";

describe("@zentity/sdk/testing", () => {
	async function verifyWithMockIssuer(token: string, audience: string) {
		const verifier = createProofOfHumanTokenVerifier({
			audience,
			issuer: "https://mock-issuer.zentity.test",
			jwksUrl: "https://mock-issuer.zentity.test/jwks.json",
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = createMockIssuer().fetch;
		try {
			return await verifier.verify(token);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}

	it("mockPohToken produces client-mode tokens accepted by the PoH verifier", async () => {
		const token = await mockPohToken({
			audience: "client-1",
			confirmationJkt: "test-jkt",
			issuer: "https://mock-issuer.zentity.test",
			subject: "user-123",
		});

		const verified = await verifyWithMockIssuer(token, "client-1");
		expect(verified).toMatchObject({
			sub: "user-123",
			aud: "client-1",
			cnf: { jkt: "test-jkt" },
			jti: expect.any(String),
			poh: {
				identity: { verified: true, strength: "documentary_full" },
				humanity: { proven: false },
			},
		});
		await expect(verifyWithMockIssuer(token, "client-2")).rejects.toThrow();
	});

	it("mockPohToken builds humanity-only tokens (identity unverified)", async () => {
		const token = await mockPohToken({
			audience: "client-1",
			confirmationJkt: "test-jkt",
			issuer: "https://mock-issuer.zentity.test",
			subject: "user-123",
			identityStrength: "none",
			identityVerified: false,
			humanityProven: true,
		});

		expect((await verifyWithMockIssuer(token, "client-1")).poh).toEqual({
			identity: { verified: false, strength: "none" },
			humanity: { proven: true },
			policy: { version: "v1.0" },
		});
	});

	it("mockMerchantPohToken produces merchant-mode tokens", async () => {
		const token = await mockMerchantPohToken({
			actorSubject: "agent-pairwise",
			authorizationDetails: [{ type: "x402_purchase" }],
			confirmationJkt: "purchase-jkt",
			issuer: "https://mock-issuer.zentity.test",
			merchant: "https://merchant.example",
			strengthAtLeast: "documentary",
			subject: "user-pairwise",
		});

		expect(
			await verifyWithMockIssuer(token, "https://merchant.example"),
		).toMatchObject({
			aud: "https://merchant.example",
			act: { sub: "agent-pairwise" },
			authorizationDetails: [{ type: "x402_purchase" }],
			poh: { identity: { strength_at_least: "documentary" } },
		});
	});

	it("createMockIssuer serves discovery and JWKS for OpenID verification", async () => {
		const issuer = createMockIssuer();
		const token = await issuer.issueGenericToken({ scope: "openid" });
		const verifier = createOpenIdTokenVerifier({
			issuerUrl: issuer.issuerUrl,
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = issuer.fetch;

		try {
			const verified = await verifier.verify(token);
			expect(verified.payload.iss).toBe(issuer.issuerUrl);
			expect(verified.payload.aud).toBe(issuer.issuerUrl);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("exports a stable Ed25519 fixture keypair", () => {
		expect(fixtureKeys.ed25519.publicJwk.kty).toBe("OKP");
		expect(fixtureKeys.ed25519.publicJwk.crv).toBe("Ed25519");
		expect(fixtureKeys.ed25519.privateJwk.d).toBeTruthy();
	});
});

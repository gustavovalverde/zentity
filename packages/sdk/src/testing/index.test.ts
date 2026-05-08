import { describe, expect, it } from "vitest";
import { createProofOfHumanTokenVerifier } from "../rp/proof-of-human";
import { createOpenIdTokenVerifier } from "../rp/token-verifier";
import { fixtureKeys } from "./fixture-keys";
import { createMockIssuer } from "./mock-issuer";
import { mockPohToken } from "./mock-poh-token";

describe("@zentity/sdk/testing", () => {
	it("mockPohToken produces tokens accepted by the PoH verifier", async () => {
		const token = await mockPohToken({
			confirmationJkt: "test-jkt",
			issuer: "https://mock-issuer.zentity.test",
			subject: "user-123",
		});
		const verifier = createProofOfHumanTokenVerifier({
			issuer: "https://mock-issuer.zentity.test",
			jwksUrl: "https://mock-issuer.zentity.test/jwks.json",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = createMockIssuer().fetch;

		try {
			const verified = await verifier.verify(token);
			expect(verified.sub).toBe("user-123");
			expect(verified.cnf?.jkt).toBe("test-jkt");
			expect(verified.poh.identity.verified).toBe(true);
			expect(verified.poh.identity.strength).toBe("documentary_full");
			expect(verified.poh.humanity.proven).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("mockPohToken builds humanity-only tokens (identity unverified)", async () => {
		const token = await mockPohToken({
			issuer: "https://mock-issuer.zentity.test",
			subject: "user-123",
			identityStrength: "none",
			identityVerified: false,
			humanityProven: true,
		});
		const verifier = createProofOfHumanTokenVerifier({
			issuer: "https://mock-issuer.zentity.test",
			jwksUrl: "https://mock-issuer.zentity.test/jwks.json",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = createMockIssuer().fetch;

		try {
			const verified = await verifier.verify(token);
			expect(verified.poh.identity.verified).toBe(false);
			expect(verified.poh.identity.strength).toBe("none");
			expect(verified.poh.humanity.proven).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("createMockIssuer serves discovery and JWKS for OpenID verification", async () => {
		const issuer = createMockIssuer();
		const token = await issuer.issueToken({ scope: "openid" });
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

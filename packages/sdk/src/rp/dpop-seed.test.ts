/**
 * Regression lock for the seed-derived DPoP key (D-G consolidation).
 *
 * The thumbprint below is the byte-identical value demo-rp's former
 * `lib/dpop.ts` produced for this seed. It anchors the
 * `(jkt, idempotency_key)` composite and the wallet's `cnf.jkt` binding,
 * so a refactor that changes it is a wire break, not a cleanup. Uses real
 * WebCrypto + `@noble/curves` (no jose mock), unlike `dpop-client.test.ts`.
 */

import { calculateJwkThumbprint, type JWK } from "jose";
import { describe, expect, it } from "vitest";

import { deriveDpopKeyPairFromSeed } from "./dpop-client";

const SEED = "dev-only-aether-bff-dpop-seed-do-not-use-in-prod-stable-48chars";
const EXPECTED_JKT = "Q6Jt79SUJ2fhFD2ktnmzbs-kQZKlUjhU5NGlZAVrKt0";

describe("deriveDpopKeyPairFromSeed", () => {
	it("is deterministic and reproduces the locked jkt", async () => {
		const first = await deriveDpopKeyPairFromSeed(SEED);
		const second = await deriveDpopKeyPairFromSeed(SEED);
		expect(first.publicJwk).toEqual(second.publicJwk);
		const jkt = await calculateJwkThumbprint(first.publicJwk as JWK, "sha256");
		expect(jkt).toBe(EXPECTED_JKT);
	});

	it("yields a different key for a different seed", async () => {
		const a = await deriveDpopKeyPairFromSeed(SEED);
		const b = await deriveDpopKeyPairFromSeed(`${SEED}-other`);
		expect(a.publicJwk).not.toEqual(b.publicJwk);
	});

	it("produces an importable ES256 EC private JWK", async () => {
		const { privateJwk } = await deriveDpopKeyPairFromSeed(SEED);
		expect(privateJwk.kty).toBe("EC");
		expect(privateJwk.crv).toBe("P-256");
		expect(privateJwk.d).toBeTruthy();
		expect(privateJwk.x).toBeTruthy();
		expect(privateJwk.y).toBeTruthy();
	});

	it("derives a stable key under a custom salt/info", async () => {
		const a = await deriveDpopKeyPairFromSeed(SEED, {
			salt: "custom-salt",
			info: "custom/info",
		});
		const b = await deriveDpopKeyPairFromSeed(SEED, {
			salt: "custom-salt",
			info: "custom/info",
		});
		expect(a.publicJwk).toEqual(b.publicJwk);
		const def = await deriveDpopKeyPairFromSeed(SEED);
		expect(a.publicJwk).not.toEqual(def.publicJwk);
	});
});

import { calculateJwkThumbprint } from "jose";
import { describe, expect, it } from "vitest";

import { createDpopClient } from "./dpop-client";
import type { DpopProofVerificationError } from "./dpop-proof-verifier";
import { verifyDpopProof } from "./dpop-proof-verifier";

describe("verifyDpopProof", () => {
	it("validates a DPoP proof against the request and sender key", async () => {
		const client = await createDpopClient();
		const proof = await client.proofFor(
			"GET",
			"https://rp.example/mcp",
			"access-token",
		);
		const expectedJkt = await calculateJwkThumbprint(
			client.keyPair.publicJwk,
			"sha256",
		);

		const result = await verifyDpopProof({
			accessToken: "access-token",
			expectedJkt,
			method: "GET",
			proof,
			url: "https://rp.example/mcp",
		});

		expect(result.publicJwk).toEqual(client.keyPair.publicJwk);
		expect(result.payload.htm).toBe("GET");
		expect(result.payload.htu).toBe("https://rp.example/mcp");
		expect(result.thumbprint).toBe(expectedJkt);
	});

	it("returns structured failures for mismatched request binding", async () => {
		const client = await createDpopClient();
		const proof = await client.proofFor(
			"GET",
			"https://rp.example/mcp",
			"access-token",
		);

		await expect(
			verifyDpopProof({
				accessToken: "access-token",
				method: "POST",
				proof,
				url: "https://rp.example/mcp",
			}),
		).rejects.toMatchObject({
			code: "method_mismatch",
			name: "DpopProofVerificationError",
		} satisfies Partial<DpopProofVerificationError>);
	});
});

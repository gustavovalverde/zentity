import { describe, expect, it } from "vitest";
import { parseDiscoveryDocument } from "./discovery";

describe("parseDiscoveryDocument", () => {
	it("drops wrong-typed and empty optional fields", () => {
		const document = parseDiscoveryDocument({
			issuer: "https://issuer.example",
			token_endpoint: 42,
			authorization_endpoint: "",
			jwks_uri: "https://issuer.example/jwks",
			dpop_signing_alg_values_supported: "ES256",
			require_pushed_authorization_requests: "yes",
			client_id_metadata_document_supported: true,
		});

		expect(document.issuer).toBe("https://issuer.example");
		expect(document.jwks_uri).toBe("https://issuer.example/jwks");
		expect(document.client_id_metadata_document_supported).toBe(true);
		for (const key of [
			"token_endpoint",
			"authorization_endpoint",
			"dpop_signing_alg_values_supported",
			"require_pushed_authorization_requests",
		] as const) {
			expect(Object.hasOwn(document, key)).toBe(true);
			expect(document[key]).toBeUndefined();
		}
	});

	it("rejects a missing or empty issuer", () => {
		expect(() => parseDiscoveryDocument({})).toThrow(
			"OpenID discovery response missing issuer",
		);
		expect(() => parseDiscoveryDocument({ issuer: "" })).toThrow(
			"OpenID discovery response missing issuer",
		);
	});

	it("rejects a non-object body", () => {
		expect(() => parseDiscoveryDocument([])).toThrow("not an object");
	});
});

import { importJWK } from "jose";

export const fixtureKeys = Object.freeze({
	ed25519: {
		publicJwk: {
			crv: "Ed25519",
			kty: "OKP",
			x: "gR8gOqTVf-4JBY4LZ3edHIjUvxpCiE1CRPDPRVx0cyQ",
		},
		privateJwk: {
			crv: "Ed25519",
			d: "aIf7FsE4fYPfW7HM01ToeUPyj1YsVw8INom6-ODwzk0",
			kty: "OKP",
			x: "gR8gOqTVf-4JBY4LZ3edHIjUvxpCiE1CRPDPRVx0cyQ",
		},
	},
});

export type FixtureKeys = typeof fixtureKeys;

let ed25519PrivateKeyPromise: ReturnType<typeof importJWK> | undefined;

export function getFixtureEd25519PrivateKey(): ReturnType<typeof importJWK> {
	if (!ed25519PrivateKeyPromise) {
		ed25519PrivateKeyPromise = importJWK(
			fixtureKeys.ed25519.privateJwk,
			"EdDSA",
		);
	}
	return ed25519PrivateKeyPromise;
}

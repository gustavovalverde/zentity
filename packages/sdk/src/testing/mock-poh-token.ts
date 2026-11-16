import { randomBytes } from "node:crypto";

import { SignJWT } from "jose";
import { getFixtureEd25519PrivateKey } from "./fixture-keys";

const DEFAULT_ISSUER = "https://mock-issuer.zentity.test";
const DEFAULT_EXPIRY_SECONDS = 300;

interface MockPohTokenBaseOptions {
	/** The thumbprint of the presenting DPoP key, as `cnf.jkt`. */
	confirmationJkt: string;
	expiresInSeconds?: number;
	issuer?: string;
	jti?: string;
	policyVersion?: string;
	subject: string;
}

/** A client-mode token: for the client that requested it. */
export interface MockPohTokenOptions extends MockPohTokenBaseOptions {
	/** The client's `client_id`. */
	audience: string;
	humanityProven?: boolean;
	identityStrength?:
		| "none"
		| "documentary"
		| "documentary_full"
		| "cryptographic_chip";
	identityVerified?: boolean;
}

/** A merchant-mode token: for one merchant and one approved purchase. */
export interface MockMerchantPohTokenOptions extends MockPohTokenBaseOptions {
	/** The agent's pairwise subject, as `act.sub`. */
	actorSubject?: string;
	/** The approved `x402_purchase` entry, without `resource_description`. */
	authorizationDetails: Record<string, unknown>[];
	/** The merchant's origin. */
	merchant: string;
	strengthAtLeast: "documentary" | "documentary_full" | "cryptographic_chip";
}

async function signPohToken(
	claims: Record<string, unknown>,
	options: MockPohTokenBaseOptions & { audience: string },
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({
		...claims,
		scope: "poh",
		cnf: { jkt: options.confirmationJkt },
	})
		.setProtectedHeader({ alg: "EdDSA", typ: "poh+jwt" })
		.setIssuer(options.issuer ?? DEFAULT_ISSUER)
		.setSubject(options.subject)
		.setAudience(options.audience)
		.setJti(options.jti ?? randomBytes(16).toString("base64url"))
		.setIssuedAt(now)
		.setExpirationTime(
			now + (options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS),
		)
		.sign(await getFixtureEd25519PrivateKey());
}

/** Signs a client-mode PoH token with the fixture Ed25519 key. */
export function mockPohToken(options: MockPohTokenOptions): Promise<string> {
	return signPohToken(
		{
			poh: {
				identity: {
					verified: options.identityVerified ?? true,
					strength: options.identityStrength ?? "documentary_full",
				},
				humanity: { proven: options.humanityProven ?? false },
				policy: { version: options.policyVersion ?? "v1.0" },
			},
		},
		options,
	);
}

/** Signs a merchant-mode PoH token with the fixture Ed25519 key. */
export function mockMerchantPohToken(
	options: MockMerchantPohTokenOptions,
): Promise<string> {
	return signPohToken(
		{
			poh: {
				identity: { strength_at_least: options.strengthAtLeast },
				policy: { version: options.policyVersion ?? "v1.0" },
			},
			authorization_details: options.authorizationDetails,
			...(options.actorSubject
				? { act: { sub: options.actorSubject, sub_profile: "service" } }
				: {}),
		},
		{ ...options, audience: options.merchant },
	);
}

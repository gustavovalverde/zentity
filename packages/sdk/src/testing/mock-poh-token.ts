import { SignJWT } from "jose";
import { getFixtureEd25519PrivateKey } from "./fixture-keys";

export interface MockPohTokenOptions {
	confirmationJkt?: string;
	expiresInSeconds?: number;
	humanityProven?: boolean;
	identityStrength?:
		| "none"
		| "documentary"
		| "documentary_full"
		| "cryptographic_chip";
	identityVerified?: boolean;
	issuer?: string;
	policyVersion?: string;
	subject: string;
}

const DEFAULT_ISSUER = "https://mock-issuer.zentity.test";
const DEFAULT_EXPIRY_SECONDS = 300;

export async function mockPohToken(
	options: MockPohTokenOptions,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const privateKey = await getFixtureEd25519PrivateKey();
	const pohClaims = {
		identity: {
			verified: options.identityVerified ?? true,
			strength: options.identityStrength ?? "documentary_full",
		},
		humanity: { proven: options.humanityProven ?? false },
		policy: { version: options.policyVersion ?? "v1.0" },
	};

	return new SignJWT({
		poh: pohClaims,
		...(options.confirmationJkt
			? { cnf: { jkt: options.confirmationJkt } }
			: {}),
	})
		.setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
		.setIssuer(options.issuer ?? DEFAULT_ISSUER)
		.setSubject(options.subject)
		.setIssuedAt(now)
		.setExpirationTime(
			now + (options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS),
		)
		.sign(privateKey);
}

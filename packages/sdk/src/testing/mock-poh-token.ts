import { SignJWT } from "jose";
import { getFixtureEd25519PrivateKey } from "./fixture-keys";

export interface MockPohTokenOptions {
	confirmationJkt?: string;
	expiresInSeconds?: number;
	issuer?: string;
	method?: "ocr" | "nfc_chip" | null;
	subject: string;
	sybilResistant?: boolean;
	tier: number;
	verified?: boolean;
}

const DEFAULT_ISSUER = "https://mock-issuer.zentity.test";
const DEFAULT_EXPIRY_SECONDS = 300;

export async function mockPohToken(
	options: MockPohTokenOptions,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const privateKey = await getFixtureEd25519PrivateKey();
	const pohClaims = {
		...(options.method === null ? {} : { method: options.method ?? "ocr" }),
		sybil_resistant: options.sybilResistant ?? true,
		tier: options.tier,
		verified: options.verified ?? true,
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

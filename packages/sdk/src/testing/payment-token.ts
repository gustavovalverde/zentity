import { type JWK, SignJWT } from "jose";

import {
	type PaymentAuthorization,
	PaymentAuthorizationDetailsSchema,
} from "../protocol";
import { fixtureKeys, getFixtureEd25519PrivateKey } from "./fixture-keys";

/**
 * Conformant `payment_authorization` `at+jwt` minter for tests and probes.
 *
 * This is the cross-language contract artifact: the token it produces is the
 * exact shape the zpay wallet's `zspend_core::verify_access_token` accepts
 * (PRD-43 D-C), so both repos test against one minter instead of a fixture
 * inlined in a probe. Unlike {@link createMockIssuer}'s `issueGenericToken`,
 * this sets `typ: "at+jwt"`, a wallet-thumbprint `aud`, a `cnf.jkt` binding,
 * exactly one `payment_authorization` entry in `authorization_details`, and a
 * lifetime capped at 120 s.
 */

type IssuerKey = Awaited<ReturnType<typeof getFixtureEd25519PrivateKey>>;

export const PAYMENT_TOKEN_ISSUER_KID = "zentity-payment-issuer";
export const PAYMENT_TOKEN_DEFAULT_ISSUER = "https://issuer.zentity.test";
const MAX_TTL_SECONDS = 120;

export interface MintPaymentAuthorizationTokenInput {
	/** The validated single RAR; the minter wraps it as `[authorization]`. */
	authorization: PaymentAuthorization;
	/** `aud`: the wallet's JWK thumbprint (D-5). */
	audience: string;
	/** `cnf.jkt`: the DPoP key that authenticated the token request. */
	dpopJkt: string;
	/** `act.sub`: the acting agent's pairwise subject, when present. */
	actorSub?: string;
	/** Defaults to the fixture Ed25519 key whose JWKS {@link paymentAuthorizationIssuerJwks} serves. */
	issuerKey?: IssuerKey;
	issuerUrl?: string;
	jti?: string;
	kid?: string;
	subject?: string;
	/** Capped at 120 s (D-6); defaults to 120. */
	expiresInSeconds?: number;
	/** Override `iat` for skew fixtures. */
	now?: number;
}

export async function mintPaymentAuthorizationToken(
	input: MintPaymentAuthorizationTokenInput,
): Promise<string> {
	// Validate the RAR so a test cannot mint a token the wallet would reject
	// for shape: the minter enforces the same contract as the issuer.
	const [authorization] = PaymentAuthorizationDetailsSchema.parse([
		input.authorization,
	]);
	const key = input.issuerKey ?? (await getFixtureEd25519PrivateKey());
	const now = input.now ?? Math.floor(Date.now() / 1000);
	const ttl = Math.min(input.expiresInSeconds ?? MAX_TTL_SECONDS, MAX_TTL_SECONDS);
	const claims: Record<string, unknown> = {
		authorization_details: [authorization],
		cnf: { jkt: input.dpopJkt },
	};
	if (input.actorSub) {
		claims.act = { sub: input.actorSub };
	}
	return new SignJWT(claims)
		.setProtectedHeader({
			alg: "EdDSA",
			kid: input.kid ?? PAYMENT_TOKEN_ISSUER_KID,
			typ: "at+jwt",
		})
		.setIssuer(input.issuerUrl ?? PAYMENT_TOKEN_DEFAULT_ISSUER)
		.setSubject(input.subject ?? "test-user")
		.setAudience(input.audience)
		.setIssuedAt(now)
		.setExpirationTime(now + ttl)
		.setJti(input.jti ?? crypto.randomUUID())
		.sign(key);
}

/**
 * The public JWKS for {@link mintPaymentAuthorizationToken}'s default fixture
 * key. Write this to the wallet's `ZSPEND_JWKS_FILE` so its verifier resolves
 * the token's `kid`.
 */
export function paymentAuthorizationIssuerJwks(
	kid: string = PAYMENT_TOKEN_ISSUER_KID,
): { keys: JWK[] } {
	return {
		keys: [{ ...fixtureKeys.ed25519.publicJwk, alg: "EdDSA", kid, use: "sig" }],
	};
}

import {
	calculateJwkThumbprint,
	decodeProtectedHeader,
	importJWK,
	type JWK,
	type JWTPayload,
	jwtVerify,
} from "jose";
import { encodeBase64Url } from "./dpop-client";

const DEFAULT_DPOP_MAX_AGE_SECONDS = 300;

export type DpopProofVerificationErrorCode =
	| "access_token_hash_mismatch"
	| "jwk_thumbprint_mismatch"
	| "malformed_proof"
	| "method_mismatch"
	| "missing_iat"
	| "missing_jwk"
	| "proof_expired"
	| "signature_invalid"
	| "unsupported_algorithm"
	| "url_mismatch";

export class DpopProofVerificationError extends Error {
	readonly code: DpopProofVerificationErrorCode;

	constructor(code: DpopProofVerificationErrorCode, message: string) {
		super(message);
		this.name = "DpopProofVerificationError";
		this.code = code;
	}
}

export interface VerifyDpopProofOptions {
	accessToken: string;
	expectedJkt?: string | undefined;
	maxAgeSeconds?: number | undefined;
	method: string;
	proof: string;
	url: string | URL;
}

export interface VerifiedDpopProof {
	payload: JWTPayload;
	publicJwk: JWK;
	thumbprint?: string | undefined;
}

function toUrlString(url: string | URL): string {
	return url instanceof URL ? url.toString() : url;
}

async function hashAccessToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return encodeBase64Url(new Uint8Array(digest));
}

function fail(code: DpopProofVerificationErrorCode, message: string): never {
	throw new DpopProofVerificationError(code, message);
}

export async function verifyDpopProof(
	options: VerifyDpopProofOptions,
): Promise<VerifiedDpopProof> {
	let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
	try {
		protectedHeader = decodeProtectedHeader(options.proof);
	} catch {
		fail("malformed_proof", "Malformed DPoP proof header");
	}

	if (protectedHeader.typ !== "dpop+jwt") {
		fail("malformed_proof", "DPoP proof typ must be dpop+jwt");
	}

	if (protectedHeader.alg !== "ES256") {
		fail("unsupported_algorithm", "DPoP proof alg must be ES256");
	}

	if (!protectedHeader.jwk) {
		fail("missing_jwk", "DPoP proof must contain jwk header");
	}

	const publicJwk = protectedHeader.jwk as JWK;
	let payload: JWTPayload;
	try {
		const publicKey = await importJWK(publicJwk, "ES256");
		payload = (await jwtVerify(options.proof, publicKey)).payload;
	} catch {
		fail("signature_invalid", "DPoP proof signature verification failed");
	}

	if (
		typeof payload.htm !== "string" ||
		payload.htm.toUpperCase() !== options.method.toUpperCase()
	) {
		fail("method_mismatch", "DPoP proof htm does not match request method");
	}

	if (
		typeof payload.htu !== "string" ||
		payload.htu !== toUrlString(options.url)
	) {
		fail("url_mismatch", "DPoP proof htu does not match request URI");
	}

	if (typeof payload.iat !== "number") {
		fail("missing_iat", "DPoP proof missing iat");
	}

	const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_DPOP_MAX_AGE_SECONDS;
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - payload.iat) > maxAgeSeconds) {
		fail("proof_expired", "DPoP proof has expired");
	}

	if (payload.ath !== (await hashAccessToken(options.accessToken))) {
		fail(
			"access_token_hash_mismatch",
			"DPoP proof ath does not match access token",
		);
	}

	let thumbprint: string | undefined;
	if (options.expectedJkt) {
		thumbprint = await calculateJwkThumbprint(publicJwk, "sha256");
		if (thumbprint !== options.expectedJkt) {
			fail(
				"jwk_thumbprint_mismatch",
				"DPoP proof key does not match token cnf.jkt",
			);
		}
	}

	return { payload, publicJwk, thumbprint };
}

import type { DpopClient } from "./dpop-client";

export type PaymentNetwork = "mainnet" | "testnet" | "regtest";

export interface WalletSpendRequestInput {
	/** The DPoP-bound `at+jwt` whose single `payment_authorization` RAR the wallet enforces. */
	accessToken: string;
	/**
	 * DPoP client whose key authenticated the token request: the issuer pins
	 * `cnf.jkt` to it, so the same key must sign the wallet proof (one `jkt`
	 * across the chain; PRD-43 Open Question 3). Seed it from the channel's
	 * single key via `createDpopClientFromSeed`.
	 */
	dpopClient: DpopClient;
	/** Absolute URL of the wallet's `POST /v1/payments/sign`. */
	walletEndpoint: string | URL;
	paymentRequest: { scheme: "zip321"; value: string };
	paymentId: string;
	/** The expiry height committed at `/prepare`; the wallet rejects a stale value. */
	targetExpiryHeight: number;
	network: PaymentNetwork;
}

export interface WalletSpendRequest {
	headers: { authorization: string; dpop: string };
	body: {
		network: PaymentNetwork;
		payment_id: string;
		payment_request: { scheme: "zip321"; value: string };
		target_expiry_height: number;
	};
}

/**
 * Assemble the authenticated `POST /v1/payments/sign` request the agent wallet
 * verifies: the access token in an `Authorization: DPoP <at>` header plus a
 * fresh `ath`-bound DPoP proof. The proof's `ath` binds it to this exact token
 * (RFC 9449), and its key must match the token's `cnf.jkt`. Returns the headers
 * and JSON body for the caller to `fetch`.
 */
export async function createWalletSpendRequest(
	input: WalletSpendRequestInput,
): Promise<WalletSpendRequest> {
	const dpop = await input.dpopClient.proofFor(
		"POST",
		input.walletEndpoint,
		input.accessToken,
	);
	return {
		headers: { authorization: `DPoP ${input.accessToken}`, dpop },
		body: {
			network: input.network,
			payment_id: input.paymentId,
			payment_request: input.paymentRequest,
			target_expiry_height: input.targetExpiryHeight,
		},
	};
}

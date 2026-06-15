/**
 * `signed_payload` envelope: the chain-neutral artifact the wallet returns
 * from `POST /v1/payments/sign` and the facilitator consumes at
 * `POST /x402/v2/settle`.
 *
 * TypeScript mirror of `zally_core::SignedPayload`. Per zpay Proposal-0003 D-3
 * the canonical `format` is `pczt-v1` (an extractor-ready PCZT). The runtime
 * currently ships `raw-zcash-v5` (a fully-signed v5 transaction) as a
 * documented interim until the PCZT path lands; see PRD-43 decision D-B in
 * `docs/plans/prd-43-agent-wallet-trust-boundary.md`. Both literals are
 * modeled so an integrator's `switch` on `format` is exhaustive today and
 * stays exhaustive after the flip.
 *
 * This is the round-trip artifact the proposal names a first-class wire type;
 * importers should consume it from here rather than re-declaring it per app.
 */

import { z } from "zod";
import { AmountSchema, ExpiresAtSchema } from "./payment-authorization";

/**
 * Canonical wire format (Proposal-0003 D-3): an extractor-ready PCZT the
 * facilitator runs through the Extractor before broadcast.
 */
export const SIGNED_PAYLOAD_FORMAT_PCZT_V1 = "pczt-v1" as const;

/**
 * Interim wire format: a fully-signed Zcash v5 transaction the wallet has
 * already extracted. Replaced by {@link SIGNED_PAYLOAD_FORMAT_PCZT_V1} when the
 * extractor-ready PCZT path lands on both the wallet and the facilitator.
 */
export const SIGNED_PAYLOAD_FORMAT_RAW_V5 = "raw-zcash-v5" as const;

export const SignedPayloadFormatSchema = z.union([
	z.literal(SIGNED_PAYLOAD_FORMAT_PCZT_V1),
	z.literal(SIGNED_PAYLOAD_FORMAT_RAW_V5),
]);
export type SignedPayloadFormat = z.infer<typeof SignedPayloadFormatSchema>;

export const SignedPayloadSchema = z.object({
	format: SignedPayloadFormatSchema,
	/** Base64 transaction bytes: a PCZT for `pczt-v1`, a raw v5 tx for the interim. */
	bytes: z.string().min(1),
	tx_id: z.string().min(1),
	fee: AmountSchema,
	expires_at: ExpiresAtSchema,
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SignedPayload = z.infer<typeof SignedPayloadSchema>;

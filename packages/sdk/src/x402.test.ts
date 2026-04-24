import { describe, expect, it, vi } from "vitest";

import {
	PAYMENT_REQUIRED_HEADER,
	PAYMENT_SIGNATURE_HEADER,
	type PaymentRequiredPayload,
	parsePaymentSignatureHeader,
} from "./rp/payment-required";
import { createX402Fetch } from "./x402";

function encodeHeader(payload: PaymentRequiredPayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function createPaymentRequiredPayload(
	minComplianceLevel = 2,
): PaymentRequiredPayload {
	return {
		x402Version: 2,
		accepts: [
			{
				scheme: "exact",
				network: "eip155:84532",
				payTo: "0x000000000000000000000000000000000000dEaD",
				amount: "1",
				maxTimeoutSeconds: 300,
				asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
				extra: {},
			},
		],
		resource: { url: "https://merchant.example/api/purchase" },
		extensions: {
			zentity: {
				minComplianceLevel,
				pohIssuer: "https://issuer.example",
			},
		},
	};
}

describe("createX402Fetch", () => {
	it("attaches a PoH token after a Zentity-gated PAYMENT-REQUIRED response", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("payment required", {
					status: 402,
					headers: {
						[PAYMENT_REQUIRED_HEADER]: encodeHeader(
							createPaymentRequiredPayload(3),
						),
					},
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
		const getPohToken = vi.fn().mockResolvedValue("poh-token");

		const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
		const response = await fetchWithX402("https://merchant.example/api", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ resourceId: "resource-1" }),
		});

		expect(response.status).toBe(200);
		expect(getPohToken).toHaveBeenCalledWith(
			3,
			expect.objectContaining({
				requirement: expect.objectContaining({ minComplianceLevel: 3 }),
			}),
		);
		const retryRequest = fetchFn.mock.calls[1]?.[0] as Request;
		const paymentSignature = retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER);
		expect(paymentSignature).toBeTruthy();
		expect(retryRequest.headers.get("Content-Type")).toBe("application/json");
		await expect(retryRequest.json()).resolves.toEqual({
			resourceId: "resource-1",
		});
		expect(
			parsePaymentSignatureHeader(paymentSignature as string),
		).toMatchObject({
			x402Version: 2,
			extensions: {
				zentity: {
					minComplianceLevel: 3,
					pohIssuer: "https://issuer.example",
					pohToken: "poh-token",
				},
			},
		});
	});

	it("passes through non-Zentity 402 responses unchanged", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response("payment required", {
				status: 402,
				headers: {
					[PAYMENT_REQUIRED_HEADER]: encodeHeader({
						...createPaymentRequiredPayload(),
						extensions: {},
					}),
				},
			}),
		);
		const getPohToken = vi.fn();

		const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
		const response = await fetchWithX402("https://merchant.example/api");

		expect(response.status).toBe(402);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(getPohToken).not.toHaveBeenCalled();
	});

	it("passes through Zentity 402 responses without an explicit PoH issuer", async () => {
		const paymentRequired = createPaymentRequiredPayload();
		paymentRequired.extensions = {
			zentity: {
				minComplianceLevel: 2,
			},
		};
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
			new Response("payment required", {
				status: 402,
				headers: {
					[PAYMENT_REQUIRED_HEADER]: encodeHeader(paymentRequired),
				},
			}),
		);
		const getPohToken = vi.fn();

		const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
		const response = await fetchWithX402("https://merchant.example/api");

		expect(response.status).toBe(402);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(getPohToken).not.toHaveBeenCalled();
	});

	it("passes through 402 responses without PAYMENT-REQUIRED", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("payment required", { status: 402 }));
		const getPohToken = vi.fn();

		const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
		const response = await fetchWithX402("https://merchant.example/api");

		expect(response.status).toBe(402);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(getPohToken).not.toHaveBeenCalled();
	});

	it("notifies the caller when the retry is forbidden", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("payment required", {
					status: 402,
					headers: {
						[PAYMENT_REQUIRED_HEADER]: encodeHeader(
							createPaymentRequiredPayload(2),
						),
					},
				}),
			)
			.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
		const onRetryForbidden = vi.fn();

		const fetchWithX402 = createX402Fetch(fetchFn, {
			getPohToken: vi.fn().mockResolvedValue("poh-token"),
			onRetryForbidden,
		});
		const response = await fetchWithX402("https://merchant.example/api");

		expect(response.status).toBe(403);
		expect(onRetryForbidden).toHaveBeenCalledWith(
			expect.objectContaining({
				requirement: expect.objectContaining({ minComplianceLevel: 2 }),
			}),
		);
	});

	it("allows callers to provide a signed payment payload before PoH is attached", async () => {
		const paymentRequired = createPaymentRequiredPayload(2);
		const createPaymentPayload = vi.fn().mockResolvedValue({
			x402Version: 2,
			resource: paymentRequired.resource,
			accepted: paymentRequired.accepts[0],
			payload: { signature: "signed-payment" },
			extensions: {
				zentity: {
					clientNonce: "nonce-1",
				},
			},
		});
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("payment required", {
					status: 402,
					headers: {
						[PAYMENT_REQUIRED_HEADER]: encodeHeader(paymentRequired),
					},
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

		const fetchWithX402 = createX402Fetch(fetchFn, {
			createPaymentPayload,
			getPohToken: vi.fn().mockResolvedValue("poh-token"),
		});
		await fetchWithX402("https://merchant.example/api");

		const retryRequest = fetchFn.mock.calls[1]?.[0] as Request;
		const paymentPayload = parsePaymentSignatureHeader(
			retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER) as string,
		);

		expect(createPaymentPayload).toHaveBeenCalledWith(
			expect.objectContaining({
				paymentRequired,
			}),
		);
		expect(paymentPayload).toMatchObject({
			payload: { signature: "signed-payment" },
			extensions: {
				zentity: {
					clientNonce: "nonce-1",
					minComplianceLevel: 2,
					pohToken: "poh-token",
				},
			},
		});
	});

	it("exposes the first advertised payment requirement as the selected requirement", async () => {
		const paymentRequired = createPaymentRequiredPayload(2);
		const firstRequirement = paymentRequired.accepts[0];
		if (!firstRequirement) {
			throw new Error("Expected payment requirement fixture");
		}
		paymentRequired.accepts.push({
			...firstRequirement,
			amount: "99",
			payTo: "0x000000000000000000000000000000000000bEEF",
		});
		const getPohToken = vi.fn().mockResolvedValue("poh-token");
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("payment required", {
					status: 402,
					headers: {
						[PAYMENT_REQUIRED_HEADER]: encodeHeader(paymentRequired),
					},
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

		const fetchWithX402 = createX402Fetch(fetchFn, { getPohToken });
		await fetchWithX402("https://merchant.example/api");

		expect(getPohToken).toHaveBeenCalledWith(
			2,
			expect.objectContaining({
				selectedPaymentRequirement: expect.objectContaining({
					amount: "1",
					payTo: "0x000000000000000000000000000000000000dEaD",
				}),
			}),
		);

		const retryRequest = fetchFn.mock.calls[1]?.[0] as Request;
		expect(
			parsePaymentSignatureHeader(
				retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER) as string,
			).accepted,
		).toMatchObject({
			amount: "1",
			payTo: "0x000000000000000000000000000000000000dEaD",
		});
	});
});

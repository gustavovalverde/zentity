import { describe, expect, it } from "vitest";

import {
	IDENTITY_STRENGTHS,
	meetsIdentityStrength,
	PurchaseAuthorizationSchema,
	X402PurchaseAuthorizationSchema,
} from "./purchase-authorization";

const PURCHASE = {
	type: "purchase",
	merchant: { name: "Corner Books" },
	item: "A paperback",
	amount: { value: "12.00", currency: "EUR" },
};

// The exact EVM scheme's EIP-3009 requirement for Base Sepolia USDC.
const EIP3009_REQUIREMENT = {
	scheme: "exact",
	network: "eip155:84532",
	amount: "1",
	asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	payTo: "0x000000000000000000000000000000000000dEaD",
	maxTimeoutSeconds: 300,
	extra: { name: "USDC", version: "2" },
};

const X402_PURCHASE = {
	type: "x402_purchase",
	resource_url:
		"https://merchant.example/api/x402/access?resourceId=verified-identity",
	resource_description: "Financial analytics",
	payment_requirements: EIP3009_REQUIREMENT,
	min_identity_strength: "documentary_full",
};

describe("purchase", () => {
	it("accepts the strict shape", () => {
		expect(PurchaseAuthorizationSchema.parse(PURCHASE)).toEqual(PURCHASE);
	});

	it.each([
		["the entry", { ...PURCHASE, url: "https://merchant.example" }],
		["merchant", { ...PURCHASE, merchant: { name: "Corner Books", id: 1 } }],
		[
			"amount",
			{ ...PURCHASE, amount: { ...PURCHASE.amount, unit: "display" } },
		],
	])("refuses an unknown member in %s", (_where, detail) => {
		expect(PurchaseAuthorizationSchema.safeParse(detail).success).toBe(false);
	});

	it.each([
		["a flat merchant", { ...PURCHASE, merchant: "Corner Books" }],
		[
			"the pre-T2 shape",
			{
				type: "purchase",
				url: "https://merchant.example",
				minComplianceLevel: 2,
				merchant: "Corner Books",
			},
		],
		["a lowercase currency", { ...PURCHASE, amount: { value: "1", currency: "eur" } }],
		["five fraction digits", { ...PURCHASE, amount: { value: "1.00001", currency: "EUR" } }],
		["a numeric amount", { ...PURCHASE, amount: { value: 12, currency: "EUR" } }],
		["a control character", { ...PURCHASE, item: "A\u0007paperback" }],
		["a format character", { ...PURCHASE, item: "A‮paperback" }],
		["an empty item", { ...PURCHASE, item: "" }],
		["a long merchant name", { ...PURCHASE, merchant: { name: "m".repeat(65) } }],
	])("refuses %s", (_case, detail) => {
		expect(PurchaseAuthorizationSchema.safeParse(detail).success).toBe(false);
	});
});

describe("x402_purchase", () => {
	it("accepts the exact EVM EIP-3009 requirement", () => {
		expect(X402PurchaseAuthorizationSchema.parse(X402_PURCHASE)).toEqual(
			X402_PURCHASE,
		);
	});

	it("accepts a Permit2 requirement", () => {
		const permit2 = {
			...X402_PURCHASE,
			payment_requirements: {
				...EIP3009_REQUIREMENT,
				extra: { assetTransferMethod: "permit2" },
			},
		};
		expect(X402PurchaseAuthorizationSchema.safeParse(permit2).success).toBe(
			true,
		);
	});

	it("accepts an explicit authorization flow and no description", () => {
		const { resource_description: _omit, ...withoutDescription } =
			X402_PURCHASE;
		const detail = {
			...withoutDescription,
			payment_requirements: {
				...EIP3009_REQUIREMENT,
				extra: { ...EIP3009_REQUIREMENT.extra, paymentFlow: "authorization" },
			},
		};
		expect(X402PurchaseAuthorizationSchema.safeParse(detail).success).toBe(
			true,
		);
	});

	it.each(["http://localhost:3102/x", "http://127.0.0.1/x", "http://[::1]/x"])(
		"accepts the loopback http resource %s",
		(resourceUrl) => {
			expect(
				X402PurchaseAuthorizationSchema.safeParse({
					...X402_PURCHASE,
					resource_url: resourceUrl,
				}).success,
			).toBe(true);
		},
	);

	it.each([
		["an unknown member", { ...X402_PURCHASE, note: "x" }],
		["an agent-typed amount", { ...X402_PURCHASE, amount: { value: "1", currency: "USD" } }],
		[
			"an unknown extra member",
			{
				...X402_PURCHASE,
				payment_requirements: {
					...EIP3009_REQUIREMENT,
					extra: { ...EIP3009_REQUIREMENT.extra, feePayer: "x" },
				},
			},
		],
		[
			"the upfront flow",
			{
				...X402_PURCHASE,
				payment_requirements: {
					...EIP3009_REQUIREMENT,
					extra: { ...EIP3009_REQUIREMENT.extra, paymentFlow: "upfront" },
				},
			},
		],
		[
			"an unknown payment requirement member",
			{
				...X402_PURCHASE,
				payment_requirements: { ...EIP3009_REQUIREMENT, description: "x" },
			},
		],
		[
			"another scheme",
			{
				...X402_PURCHASE,
				payment_requirements: { ...EIP3009_REQUIREMENT, scheme: "upto" },
			},
		],
		[
			"a decimal amount",
			{
				...X402_PURCHASE,
				payment_requirements: { ...EIP3009_REQUIREMENT, amount: "0.5" },
			},
		],
		[
			"a zero amount",
			{
				...X402_PURCHASE,
				payment_requirements: { ...EIP3009_REQUIREMENT, amount: "0" },
			},
		],
		[
			"a timeout over an hour",
			{
				...X402_PURCHASE,
				payment_requirements: {
					...EIP3009_REQUIREMENT,
					maxTimeoutSeconds: 3601,
				},
			},
		],
		["a numeric strength", { ...X402_PURCHASE, min_identity_strength: 2 }],
		["an http resource", { ...X402_PURCHASE, resource_url: "http://merchant.example/x" }],
		["a fragment", { ...X402_PURCHASE, resource_url: "https://merchant.example/x#y" }],
		[
			"a control character in the resource",
			{ ...X402_PURCHASE, resource_url: "https://merchant.example/\tx" },
		],
	])("refuses %s", (_case, detail) => {
		expect(X402PurchaseAuthorizationSchema.safeParse(detail).success).toBe(
			false,
		);
	});
});

describe("identity strength", () => {
	it("orders the vocabulary weakest first", () => {
		expect(IDENTITY_STRENGTHS).toEqual([
			"documentary",
			"documentary_full",
			"cryptographic_chip",
		]);
	});

	it.each([
		["documentary_full", "documentary", true],
		["documentary_full", "documentary_full", true],
		["documentary", "documentary_full", false],
		["cryptographic_chip", "documentary_full", true],
		["none", "documentary", false],
		["unknown", "documentary", false],
	] as const)("%s meets %s: %s", (actual, required, expected) => {
		expect(meetsIdentityStrength(actual, required)).toBe(expected);
	});
});

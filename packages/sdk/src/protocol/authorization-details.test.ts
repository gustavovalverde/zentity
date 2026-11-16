import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	AUTHORIZATION_DETAILS_TYPES,
	canonicalJson,
	taskHash,
	taskHashPayload,
} from "./authorization-details";

const VALID_ENTRIES = {
	payment_authorization: {
		type: "payment_authorization",
		chain: { namespace: "zcash", reference: "test" },
		recipient: "zcash:test:utest1qq0",
		amount: { currency: "ZEC", value: "50000000", unit: "base" },
		payment_id: "pay_123",
		intent_hash: `v1:sha256:${"A".repeat(43)}`,
		expires_at: { kind: "block_height", value: 4_056_276 },
	},
	purchase: {
		type: "purchase",
		merchant: { name: "Corner Books" },
		item: "A paperback",
		amount: { value: "12.00", currency: "EUR" },
	},
	x402_purchase: {
		type: "x402_purchase",
		resource_url: "https://merchant.example/api/x402/access?resourceId=a",
		payment_requirements: {
			scheme: "exact",
			network: "eip155:84532",
			amount: "1",
			asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
			payTo: "0x000000000000000000000000000000000000dEaD",
			maxTimeoutSeconds: 300,
			extra: { name: "USDC", version: "2" },
		},
		min_identity_strength: "documentary_full",
	},
} as const;

describe("registered types", () => {
	it("registers payment_authorization, purchase, and x402_purchase", () => {
		expect(Object.keys(AUTHORIZATION_DETAILS_TYPES)).toEqual([
			"payment_authorization",
			"purchase",
			"x402_purchase",
		]);
	});

	// R2: a known type with an unknown member is refused (RFC 9396 §5).
	it.each(Object.keys(VALID_ENTRIES) as (keyof typeof VALID_ENTRIES)[])(
		"%s accepts its valid entry and refuses an unknown member",
		(type) => {
			const schema = AUTHORIZATION_DETAILS_TYPES[type];
			const entry = VALID_ENTRIES[type];
			expect(schema.safeParse(entry).success).toBe(true);
			expect(schema.safeParse({ ...entry, unexpected: true }).success).toBe(
				false,
			);
		},
	);

	it("parses without transforming the entry", () => {
		for (const [type, entry] of Object.entries(VALID_ENTRIES)) {
			const schema =
				AUTHORIZATION_DETAILS_TYPES[type as keyof typeof VALID_ENTRIES];
			expect(schema.parse(entry)).toEqual(entry);
		}
	});
});

describe("canonicalJson", () => {
	// RFC 8785 §3.2.3: keys sort by UTF-16 code units.
	it("sorts the RFC 8785 property-sorting example", () => {
		const input = {
			"€": "Euro Sign",
			"\r": "Carriage Return",
			"דּ": "Hebrew Letter Dalet With Dagesh",
			"1": "One",
			"😀": "Emoji: Grinning Face",
			"\u0080": "Control",
			"ö": "Latin Small Letter O With Diaeresis",
		};
		expect(canonicalJson(input)).toBe(
			'{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
		);
	});

	// RFC 8785 §3.2.2 example, the members inside this function's domain.
	it("serializes the RFC 8785 string and literal example", () => {
		const input = {
			string: "€$\u000F\nA'B\"\\\\\"/",
			literals: [true, false],
		};
		expect(canonicalJson(input)).toBe(
			'{"literals":[true,false],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
		);
	});

	it("serializes nested arrays and safe integers", () => {
		expect(canonicalJson({ b: [2, { d: 1, c: 0 }], a: -1 })).toBe(
			'{"a":-1,"b":[2,{"c":0,"d":1}]}',
		);
	});

	it.each([
		["null", null],
		["a fraction", 1.5],
		["an unsafe integer", 2 ** 53],
		["undefined", undefined],
		["a lone surrogate", "\ud83d"],
		["a date", new Date(0)],
		["a nested null", { a: [null] }],
	])("refuses %s", (_case, value) => {
		expect(() => canonicalJson(value)).toThrow(TypeError);
	});
});

describe("taskHash", () => {
	const detail = VALID_ENTRIES.x402_purchase;

	it("hashes the canonical request", async () => {
		const expected = createHash("sha256")
			.update(
				canonicalJson({
					binding_message: "Proof-of-Human for merchant.example",
					scope: ["openid", "poh"],
					authorization_details: [detail],
				}),
			)
			.digest("hex");

		expect(
			await taskHash({
				bindingMessage: "Proof-of-Human for merchant.example",
				scope: "openid poh",
				authorizationDetails: [detail],
			}),
		).toBe(expected);
	});

	// R17: representation changes do not change the hash.
	it("ignores scope order, duplicate scopes, and key order", async () => {
		const reordered = JSON.stringify([
			Object.fromEntries(Object.entries(detail).reverse()),
		]);
		const a = await taskHash({
			bindingMessage: "Buy",
			scope: "openid poh",
			authorizationDetails: [detail],
		});
		const b = await taskHash({
			bindingMessage: "Buy",
			scope: ["poh", "openid", "poh"],
			authorizationDetails: reordered,
		});
		expect(b).toBe(a);
	});

	it.each([
		["the binding message", { bindingMessage: "Buy two" }],
		["the scope", { scope: "openid poh email" }],
		["the acr values", { acrValues: "urn:zentity:assurance:tier-2" }],
		[
			"the details",
			{
				authorizationDetails: [
					{
						...detail,
						payment_requirements: { ...detail.payment_requirements, amount: "2" },
					},
				],
			},
		],
	])("changes with %s", async (_case, change) => {
		const base = {
			bindingMessage: "Buy",
			scope: "openid poh",
			authorizationDetails: [detail] as unknown[],
		};
		expect(await taskHash({ ...base, ...change })).not.toBe(
			await taskHash(base),
		);
	});

	it("keeps acr_values in their order and drops empty lists", () => {
		expect(
			taskHashPayload({
				bindingMessage: "Buy",
				scope: "openid",
				acrValues: "b a",
				authorizationDetails: [],
			}),
		).toEqual({ binding_message: "Buy", scope: ["openid"], acr_values: ["b", "a"] });
	});

	it("differs from the hash of the binding message alone", async () => {
		const bindingOnly = createHash("sha256").update("Buy").digest("hex");
		expect(await taskHash({ bindingMessage: "Buy", scope: "openid" })).not.toBe(
			bindingOnly,
		);
	});

	it("refuses details that are not an array", () => {
		expect(() =>
			taskHashPayload({
				bindingMessage: "Buy",
				scope: "openid",
				authorizationDetails: '{"type":"purchase"}',
			}),
		).toThrow(TypeError);
	});
});

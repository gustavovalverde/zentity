import { describe, expect, it } from "vitest";

import {
	findRegisteredAsset,
	formatAtomic,
	REGISTERED_ASSETS,
	toAtomic,
} from "./asset-registry";

const USDC = REGISTERED_ASSETS[0] as (typeof REGISTERED_ASSETS)[number];

describe("asset registry", () => {
	it("registers Base Sepolia USDC only", () => {
		expect(REGISTERED_ASSETS).toEqual([
			{
				network: "eip155:84532",
				networkName: "Base Sepolia",
				asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
				decimals: 6,
				name: "USDC",
				symbol: "USDC",
				version: "2",
			},
		]);
	});

	it("finds an asset regardless of address case", () => {
		expect(
			findRegisteredAsset(
				"eip155:84532",
				"0x036cbd53842c5426634e7929541ec2318f3dcf7e",
			),
		).toBe(USDC);
	});

	it.each([
		["another network", "eip155:8453", USDC.asset],
		["another asset", "eip155:84532", "0x0000000000000000000000000000000000000001"],
	])("finds nothing on %s", (_case, network, asset) => {
		expect(findRegisteredAsset(network, asset)).toBeUndefined();
	});
});

describe("toAtomic", () => {
	it.each([
		["1", "1000000"],
		["1.00", "1000000"],
		["0.000001", "1"],
		["5", "5000000"],
		["12.5", "12500000"],
		["0", "0"],
	])("converts %s USDC to %s", (display, atomic) => {
		expect(toAtomic(display, USDC)).toBe(atomic);
	});

	it.each([
		[1, "1000000"],
		[1.1, "1100000"],
		[0.000001, "1"],
		[5, "5000000"],
	])("converts the number %s without float drift", (display, atomic) => {
		expect(toAtomic(display, USDC)).toBe(atomic);
	});

	it.each(["1.0000001", "-1", "1e3", "", ".5", "01"])(
		"refuses %s",
		(display) => {
			expect(() => toAtomic(display, USDC)).toThrow(RangeError);
		},
	);

	it.each([Number.NaN, -1, Number.POSITIVE_INFINITY, 1e-7])(
		"refuses the number %s",
		(display) => {
			expect(() => toAtomic(display, USDC)).toThrow(RangeError);
		},
	);
});

describe("formatAtomic", () => {
	it.each([
		["1", "0.000001"],
		["1000000", "1"],
		["2000000", "2"],
		["12500000", "12.5"],
		["0", "0"],
		["123456789012345678901234567890", "123456789012345678901234.56789"],
	])("formats %s as %s USDC", (atomic, display) => {
		expect(formatAtomic(atomic, USDC)).toBe(display);
	});

	it("refuses a display amount", () => {
		expect(() => formatAtomic("1.5", USDC)).toThrow(RangeError);
	});
});

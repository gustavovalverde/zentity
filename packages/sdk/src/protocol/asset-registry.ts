/**
 * The x402 payment assets Zentity recognizes. An `x402_purchase` request for
 * any other asset is refused at bc-authorize, and approval surfaces format
 * amounts from this list.
 *
 * The one entry matches `DEFAULT_ASSETS["eip155:84532"]` in `@x402/evm`; a
 * demo-rp test keeps the two in step without making this package depend on
 * `@x402/evm`.
 */

export interface RegisteredAsset {
	/** The token contract, as `PaymentRequirements.asset` names it. */
	asset: string;
	decimals: number;
	/** The EIP-712 domain name the exact EVM scheme signs with. */
	name: string;
	/** CAIP-2 chain id. */
	network: string;
	/** The network's display name. */
	networkName: string;
	symbol: string;
	/** The EIP-712 domain version the exact EVM scheme signs with. */
	version: string;
}

export const REGISTERED_ASSETS: readonly RegisteredAsset[] = [
	{
		network: "eip155:84532",
		networkName: "Base Sepolia",
		asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
		decimals: 6,
		name: "USDC",
		symbol: "USDC",
		version: "2",
	},
];

/** The registered asset on `network`, compared case-insensitively. */
export function findRegisteredAsset(
	network: string,
	asset: string,
): RegisteredAsset | undefined {
	const wanted = asset.toLowerCase();
	return REGISTERED_ASSETS.find(
		(entry) =>
			entry.network === network && entry.asset.toLowerCase() === wanted,
	);
}

const DISPLAY_AMOUNT = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const TRAILING_ZEROS = /0+$/;

/**
 * Converts a display amount (`"1.5"`, or a finite non-negative number) to the
 * asset's atomic units as a decimal string. Throws when the amount has more
 * fraction digits than the asset.
 */
export function toAtomic(
	display: string | number,
	asset: Pick<RegisteredAsset, "decimals">,
): string {
	const text = typeof display === "number" ? numberToDecimal(display) : display;
	const match = DISPLAY_AMOUNT.exec(text);
	if (!match) {
		throw new RangeError(`not a non-negative decimal amount: ${text}`);
	}
	const whole = match[1] ?? "0";
	const fraction = (match[2] ?? "").replace(TRAILING_ZEROS, "");
	if (fraction.length > asset.decimals) {
		throw new RangeError(
			`amount ${text} has more than ${asset.decimals} fraction digits`,
		);
	}
	const scale = 10n ** BigInt(asset.decimals);
	const atomic =
		BigInt(whole) * scale + BigInt(fraction.padEnd(asset.decimals, "0") || "0");
	return atomic.toString();
}

/** Formats an atomic amount in display units, without trailing zeros. */
export function formatAtomic(
	amount: string,
	asset: Pick<RegisteredAsset, "decimals">,
): string {
	if (!/^[0-9]+$/.test(amount)) {
		throw new RangeError(`not an atomic amount: ${amount}`);
	}
	const scale = 10n ** BigInt(asset.decimals);
	const units = BigInt(amount);
	const whole = (units / scale).toString();
	const fraction = (units % scale)
		.toString()
		.padStart(asset.decimals, "0")
		.replace(TRAILING_ZEROS, "");
	return fraction ? `${whole}.${fraction}` : whole;
}

function numberToDecimal(value: number): string {
	if (!(Number.isFinite(value) && value >= 0)) {
		throw new RangeError(`not a non-negative finite amount: ${value}`);
	}
	// String() gives the shortest digits that round-trip (1.1, not
	// 1.100000000000000088); only exponent forms need expanding.
	const shortest = String(value);
	if (!/e/i.test(shortest)) {
		return shortest;
	}
	const fixed = value.toFixed(20).replace(TRAILING_ZEROS, "");
	return fixed.endsWith(".") ? fixed.slice(0, -1) : fixed;
}

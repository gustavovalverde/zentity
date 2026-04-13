/**
 * Token Conversion Utilities
 *
 * Wei/decimal conversion for ERC20 tokens.
 * Default assumes 18 decimals (standard ERC20).
 */

const DEFAULT_DECIMALS = 18;

/**
 * Parse a human-readable token amount to wei.
 *
 * @param amount - Human-readable amount (e.g., "100.5")
 * @param decimals - Token decimals (default: 18)
 * @returns Wei amount as bigint
 *
 * @example
 * parseTokenAmount("100") // 100000000000000000000n
 * parseTokenAmount("1.5", 18) // 1500000000000000000n
 */
export function parseTokenAmount(
  amount: string,
  decimals: number = DEFAULT_DECIMALS
): bigint {
  const parsed = Number.parseFloat(amount);
  if (Number.isNaN(parsed) || parsed < 0) {
    return BigInt(0);
  }

  // Use integer math to avoid floating point errors
  // Multiply by 100 first to preserve 2 decimal places, then scale up
  const scaledAmount = Math.floor(parsed * 100);
  const factor = BigInt(10) ** BigInt(decimals - 2);
  return BigInt(scaledAmount) * factor;
}

/**
 * Format a wei amount to a human-readable string.
 *
 * @param wei - Wei amount as bigint or string
 * @param decimals - Token decimals (default: 18)
 * @returns Formatted string with locale separators
 *
 * @example
 * formatTokenAmount(100000000000000000000n) // "100"
 * formatTokenAmount("1500000000000000000", 18) // "1"
 */
export function formatTokenAmount(
  wei: bigint | string,
  decimals: number = DEFAULT_DECIMALS
): string {
  const value = typeof wei === "string" ? BigInt(wei) : wei;
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  return whole.toLocaleString();
}

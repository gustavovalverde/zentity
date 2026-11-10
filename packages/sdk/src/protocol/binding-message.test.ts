import { describe, expect, it } from "vitest";

import {
	BINDING_MESSAGE_MAX_LENGTH,
	truncateBindingMessage,
} from "./binding-message";

describe("truncateBindingMessage", () => {
	it("keeps a message that fits", () => {
		const message = "Aether: Buy Acme Trail Runner";

		expect(truncateBindingMessage(message)).toBe(message);
		expect(truncateBindingMessage("x".repeat(64))).toBe("x".repeat(64));
	});

	it("cuts a long message to the limit and marks the cut", () => {
		const fitted = truncateBindingMessage(
			"Confirm code: 123456 · Purchase Northwind Ultralight Trail Running Shoes",
		);

		expect(fitted.length).toBeLessThanOrEqual(BINDING_MESSAGE_MAX_LENGTH);
		expect(fitted).toBe(
			"Confirm code: 123456 · Purchase Northwind Ultralight Trail Runn…",
		);
	});

	it("never splits a surrogate pair", () => {
		const fitted = truncateBindingMessage(`${"a".repeat(62)}😀😀`);

		expect(fitted).toBe(`${"a".repeat(62)}…`);
		expect(fitted.length).toBeLessThanOrEqual(BINDING_MESSAGE_MAX_LENGTH);
	});
});

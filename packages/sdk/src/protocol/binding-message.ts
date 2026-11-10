/**
 * The longest CIBA `binding_message` Zentity accepts, in UTF-16 code units.
 * A longer one is refused with `invalid_binding_message`.
 */
export const BINDING_MESSAGE_MAX_LENGTH = 64;

const ELLIPSIS = "…";

/**
 * Shortens a CIBA `binding_message` to {@link BINDING_MESSAGE_MAX_LENGTH},
 * ending it with "…" when text is cut. Shorten the message before showing it
 * or hashing it into an Agent-Assertion, so every copy matches the one the
 * user approves.
 */
export function truncateBindingMessage(message: string): string {
	if (message.length <= BINDING_MESSAGE_MAX_LENGTH) {
		return message;
	}
	let kept = "";
	for (const char of message) {
		const room = BINDING_MESSAGE_MAX_LENGTH - ELLIPSIS.length;
		if (kept.length + char.length > room) {
			break;
		}
		kept += char;
	}
	return `${kept.trimEnd()}${ELLIPSIS}`;
}

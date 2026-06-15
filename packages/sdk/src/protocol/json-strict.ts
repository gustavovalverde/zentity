// Strict JSON parsing for security-critical token decoding.
//
// JSON.parse silently accepts duplicate keys (last-wins). For JWT/SD-JWT
// claims that drive authorization decisions, that lets an attacker craft
// payloads where one component validates one claim value while another
// component reads a different one (parser differential / claim shadowing).
// See: eprint.iacr.org/2026/227 (zkLogin analysis), §4.0.1.
//
// This module tokenises the raw JSON byte-by-byte, rejects duplicate keys
// at any nesting depth, and refuses non-conformant input (trailing data,
// non-objects at the top level, escape-aware string termination, RFC 8259
// number grammar). Escape sequences and Unicode escapes are decoded before
// duplicate detection so that {"iss":"x","iss":"y"} is also rejected.

const JSON_WHITESPACE_RE = /\s/;
const JSON_PRIMITIVE_RE =
	/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function skipWhitespace(json: string, index: number): number {
	let cursor = index;
	while (JSON_WHITESPACE_RE.test(json[cursor] ?? "")) {
		cursor += 1;
	}
	return cursor;
}

function parseJsonString(json: string, index: number): number {
	if (json[index] !== '"') {
		throw new Error("Expected JSON string");
	}
	let cursor = index + 1;
	while (cursor < json.length) {
		const char = json[cursor];
		if (char === '"') {
			return cursor + 1;
		}
		if (char === "\\") {
			cursor += 2;
		} else {
			cursor += 1;
		}
	}
	throw new Error("Unterminated JSON string");
}

function readJsonString(
	json: string,
	index: number,
): { next: number; value: string } {
	const next = parseJsonString(json, index);
	return { next, value: JSON.parse(json.slice(index, next)) as string };
}

function assertNoDuplicateJsonObjectKeys(json: string): void {
	function parseValue(index: number): number {
		const cursor = skipWhitespace(json, index);
		const char = json[cursor];
		if (char === "{") {
			return parseObject(cursor);
		}
		if (char === "[") {
			return parseArray(cursor);
		}
		if (char === '"') {
			return parseJsonString(json, cursor);
		}
		const match = json.slice(cursor).match(JSON_PRIMITIVE_RE);
		if (!match) {
			throw new Error("Invalid JSON value");
		}
		return cursor + match[0].length;
	}

	function parseObject(index: number): number {
		const keys = new Set<string>();
		let cursor = skipWhitespace(json, index + 1);
		if (json[cursor] === "}") {
			return cursor + 1;
		}
		while (cursor < json.length) {
			const key = readJsonString(json, cursor);
			if (keys.has(key.value)) {
				throw new Error(`Duplicate JSON key: ${key.value}`);
			}
			keys.add(key.value);
			cursor = skipWhitespace(json, key.next);
			if (json[cursor] !== ":") {
				throw new Error("Expected JSON property separator");
			}
			cursor = skipWhitespace(json, parseValue(cursor + 1));
			if (json[cursor] === "}") {
				return cursor + 1;
			}
			if (json[cursor] !== ",") {
				throw new Error("Expected JSON property delimiter");
			}
			cursor = skipWhitespace(json, cursor + 1);
		}
		throw new Error("Unterminated JSON object");
	}

	function parseArray(index: number): number {
		let cursor = skipWhitespace(json, index + 1);
		if (json[cursor] === "]") {
			return cursor + 1;
		}
		while (cursor < json.length) {
			cursor = skipWhitespace(json, parseValue(cursor));
			if (json[cursor] === "]") {
				return cursor + 1;
			}
			if (json[cursor] !== ",") {
				throw new Error("Expected JSON array delimiter");
			}
			cursor = skipWhitespace(json, cursor + 1);
		}
		throw new Error("Unterminated JSON array");
	}

	const end = skipWhitespace(json, parseValue(0));
	if (end !== json.length) {
		throw new Error("Unexpected JSON trailing data");
	}
}

export function parseStrictJson(json: string): unknown {
	assertNoDuplicateJsonObjectKeys(json);
	return JSON.parse(json) as unknown;
}

export function parseStrictJsonObject(json: string): Record<string, unknown> {
	const parsed = parseStrictJson(json);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Expected JSON object");
	}
	return parsed as Record<string, unknown>;
}

export function decodeBase64UrlJsonStrict(part: string): unknown {
	return parseStrictJson(utf8Decoder.decode(Buffer.from(part, "base64url")));
}

function decodeJwtSegmentStrict(
	token: string,
	index: number,
): Record<string, unknown> {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[index]) {
		throw new Error("Expected compact JWT");
	}
	const bytes = Buffer.from(parts[index], "base64url");
	return parseStrictJsonObject(utf8Decoder.decode(bytes));
}

export function decodeJwtHeaderStrict(token: string): Record<string, unknown> {
	return decodeJwtSegmentStrict(token, 0);
}

export function decodeJwtPayloadStrict(token: string): Record<string, unknown> {
	return decodeJwtSegmentStrict(token, 1);
}

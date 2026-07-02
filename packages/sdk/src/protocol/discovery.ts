export const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;

export interface DiscoveryDocument {
	authorization_challenge_endpoint?: string;
	authorization_endpoint?: string;
	backchannel_authentication_endpoint?: string;
	client_id_metadata_document_supported?: boolean;
	dpop_signing_alg_values_supported?: string[];
	issuer: string;
	jwks_uri?: string;
	pushed_authorization_request_endpoint?: string;
	registration_endpoint?: string;
	require_pushed_authorization_requests?: boolean;
	token_endpoint?: string;
}

export interface DiscoveryResolverOptions {
	discoveryTtlMs?: number;
	discoveryUrl?: string | URL;
	fetch?: typeof globalThis.fetch;
	issuerUrl: string | URL;
}

export interface DiscoveryResolver {
	clear(): void;
	peek(): DiscoveryDocument | undefined;
	read(): Promise<DiscoveryDocument>;
}

interface CachedDiscoveryDocument {
	document: DiscoveryDocument;
	expiresAt: number;
}

function toUrl(value: string | URL): URL {
	return value instanceof URL ? value : new URL(value);
}

export function resolveDiscoveryUrl(options: {
	discoveryUrl?: string | URL;
	issuerUrl: string | URL;
}): URL {
	if (options.discoveryUrl) {
		return toUrl(options.discoveryUrl);
	}

	return new URL("/.well-known/openid-configuration", toUrl(options.issuerUrl));
}

function readOptionalString(
	source: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalBoolean(
	source: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = source[key];
	return typeof value === "boolean" ? value : undefined;
}

function readOptionalStringArray(
	source: Record<string, unknown>,
	key: string,
): string[] | undefined {
	const value = source[key];
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		return undefined;
	}

	return value;
}

function requireString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`OpenID discovery response missing ${key}`);
	}
	return value;
}

export function parseDiscoveryDocument(body: unknown): DiscoveryDocument {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("OpenID discovery response is not an object");
	}

	const source = body as Record<string, unknown>;
	const optionalStrings = [
		"authorization_challenge_endpoint",
		"authorization_endpoint",
		"backchannel_authentication_endpoint",
		"jwks_uri",
		"pushed_authorization_request_endpoint",
		"registration_endpoint",
		"token_endpoint",
	] as const;
	const optionalBooleans = [
		"client_id_metadata_document_supported",
		"require_pushed_authorization_requests",
	] as const;

	const document: DiscoveryDocument = { issuer: requireString(source, "issuer") };

	for (const key of optionalStrings) {
		const value = readOptionalString(source, key);
		if (value !== undefined) {
			document[key] = value;
		}
	}

	for (const key of optionalBooleans) {
		const value = readOptionalBoolean(source, key);
		if (value !== undefined) {
			document[key] = value;
		}
	}

	const dpopSigningAlgorithms = readOptionalStringArray(
		source,
		"dpop_signing_alg_values_supported",
	);
	if (dpopSigningAlgorithms) {
		document.dpop_signing_alg_values_supported = dpopSigningAlgorithms;
	}

	return document;
}

export function resolveCacheTtlMs(
	headers: Headers,
	fallbackTtlMs: number,
): number | null {
	const cacheControl = headers.get("cache-control");
	if (!cacheControl) {
		return fallbackTtlMs;
	}

	const directives = cacheControl
		.split(",")
		.map((directive) => directive.trim().toLowerCase());

	if (directives.includes("no-store")) {
		return null;
	}

	const maxAgeDirective = directives.find((directive) =>
		directive.startsWith("max-age="),
	);
	if (!maxAgeDirective) {
		return fallbackTtlMs;
	}

	const maxAgeSeconds = Number(maxAgeDirective.slice("max-age=".length));
	if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
		return fallbackTtlMs;
	}

	return maxAgeSeconds * 1000;
}

export function createDiscoveryResolver(
	options: DiscoveryResolverOptions,
): DiscoveryResolver {
	let cached: CachedDiscoveryDocument | undefined;

	return {
		clear() {
			cached = undefined;
		},
		peek() {
			if (!cached || Date.now() >= cached.expiresAt) {
				return undefined;
			}

			return cached.document;
		},
		async read() {
			if (cached && Date.now() < cached.expiresAt) {
				return cached.document;
			}

			const response = await (options.fetch ?? fetch)(
				resolveDiscoveryUrl(options),
			);
			if (!response.ok) {
				throw new Error(
					`Discovery failed: ${response.status} ${response.statusText}`,
				);
			}

			const document = parseDiscoveryDocument(await response.json());
			const ttlMs = resolveCacheTtlMs(
				response.headers,
				options.discoveryTtlMs ?? DEFAULT_DISCOVERY_TTL_MS,
			);

			cached =
				ttlMs && ttlMs > 0
					? { document, expiresAt: Date.now() + ttlMs }
					: undefined;

			return document;
		},
	};
}

import { z } from "zod";

export const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;

// Discovery documents are read leniently: an optional field of the wrong type
// or an empty string is dropped rather than rejected.
const lenient = <T extends z.ZodType>(schema: T) =>
	schema.optional().catch(undefined);
const lenientString = lenient(z.string().min(1));

const discoveryDocumentSchema = z.object({
	authorization_challenge_endpoint: lenientString,
	authorization_endpoint: lenientString,
	backchannel_authentication_endpoint: lenientString,
	client_id_metadata_document_supported: lenient(z.boolean()),
	dpop_signing_alg_values_supported: lenient(z.array(z.string())),
	issuer: z.string().min(1),
	jwks_uri: lenientString,
	pushed_authorization_request_endpoint: lenientString,
	registration_endpoint: lenientString,
	require_pushed_authorization_requests: lenient(z.boolean()),
	token_endpoint: lenientString,
	userinfo_endpoint: lenientString,
});

export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;

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

export function parseDiscoveryDocument(body: unknown): DiscoveryDocument {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("OpenID discovery response is not an object");
	}

	const result = discoveryDocumentSchema.safeParse(body);
	if (!result.success) {
		// `issuer` is the only field that is not lenient.
		throw new Error("OpenID discovery response missing issuer");
	}
	return result.data;
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

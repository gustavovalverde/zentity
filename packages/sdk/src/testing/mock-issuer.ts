import { SignJWT } from "jose";
import { fixtureKeys, getFixtureEd25519PrivateKey } from "./fixture-keys";

export interface MockIssuerRequestContext {
	body: string;
	headers: Headers;
	method: string;
	pathname: string;
	request: Request;
	searchParams: URLSearchParams;
	url: URL;
}

export type MockIssuerRouteHandler =
	| Response
	| ((context: MockIssuerRequestContext) => Response | Promise<Response>);

export interface CreateMockIssuerOptions {
	issuerUrl?: string;
	routes?: Record<string, MockIssuerRouteHandler>;
}

export interface MockIssuer {
	fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
	issueToken(
		claims?: Record<string, unknown>,
		options?: {
			audience?: string | string[];
			expiresInSeconds?: number;
			subject?: string;
		},
	): Promise<string>;
	issuerUrl: string;
	jwksUrl: string;
	openIdConfigurationUrl: string;
}

const DEFAULT_EXPIRY_SECONDS = 300;
const DEFAULT_ISSUER_URL = "https://mock-issuer.zentity.test";

function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

function resolveRequestUrl(
	input: Request | URL | string,
	init?: RequestInit,
): URL {
	if (input instanceof Request) {
		return new URL(input.url);
	}

	if (input instanceof URL) {
		return input;
	}

	return new URL(input, init?.referrer);
}

export function createMockIssuer(
	options: CreateMockIssuerOptions = {},
): MockIssuer {
	const issuerUrl = options.issuerUrl ?? DEFAULT_ISSUER_URL;
	const openIdConfigurationUrl = new URL(
		"/.well-known/openid-configuration",
		issuerUrl,
	).toString();
	const jwksUrl = new URL("/jwks.json", issuerUrl).toString();

	async function fetch(
		input: Request | URL | string,
		init?: RequestInit,
	): Promise<Response> {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = resolveRequestUrl(input, init);
		const route = options.routes?.[url.pathname];

		if (url.pathname === "/.well-known/openid-configuration") {
			return json({
				issuer: issuerUrl,
				jwks_uri: jwksUrl,
				token_endpoint: new URL("/oauth2/token", issuerUrl).toString(),
				userinfo_endpoint: new URL("/userinfo", issuerUrl).toString(),
			});
		}

		if (url.pathname === "/jwks.json") {
			return json({
				keys: [fixtureKeys.ed25519.publicJwk],
			});
		}

		if (!route) {
			return json({ error: "not_found" }, { status: 404 });
		}

		if (route instanceof Response) {
			return route;
		}

		const body = await request.text();
		return route({
			body,
			headers: request.headers,
			method: request.method,
			pathname: url.pathname,
			request,
			searchParams: url.searchParams,
			url,
		});
	}

	async function issueToken(
		claims: Record<string, unknown> = {},
		optionsOverride: {
			audience?: string | string[];
			expiresInSeconds?: number;
			subject?: string;
		} = {},
	): Promise<string> {
		const privateKey = await getFixtureEd25519PrivateKey();
		const now = Math.floor(Date.now() / 1000);
		return new SignJWT(claims)
			.setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
			.setIssuer(issuerUrl)
			.setIssuedAt(now)
			.setExpirationTime(
				now + (optionsOverride.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS),
			)
			.setSubject(optionsOverride.subject ?? "mock-user")
			.setAudience(optionsOverride.audience ?? issuerUrl)
			.sign(privateKey);
	}

	return {
		fetch,
		issueToken,
		issuerUrl,
		jwksUrl,
		openIdConfigurationUrl,
	};
}

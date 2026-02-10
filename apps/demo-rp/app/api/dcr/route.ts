import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

const zentityUrl = process.env.ZENTITY_URL || "http://localhost:3000";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3102";

const ENV_CLIENT_IDS: Record<string, string> = {
	bank: "ZENTITY_BANK_CLIENT_ID",
	exchange: "ZENTITY_EXCHANGE_CLIENT_ID",
	wine: "ZENTITY_WINE_CLIENT_ID",
	aid: "ZENTITY_AID_CLIENT_ID",
	veripass: "ZENTITY_VERIPASS_CLIENT_ID",
};

function dcrPath(providerId: string) {
	return join(process.cwd(), ".data", `dcr-${providerId}.json`);
}

function readDcrClientId(providerId: string): string | null {
	const path = dcrPath(providerId);
	if (!existsSync(path)) return null;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8"));
		return typeof data.client_id === "string" ? data.client_id : null;
	} catch {
		return null;
	}
}

function resolveEnvClientId(providerId: string): string | null {
	const envKey = ENV_CLIENT_IDS[providerId];
	if (!envKey) return null;
	const value = process.env[envKey]?.trim();
	return value || null;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const providerId = searchParams.get("providerId");
	if (!providerId) {
		return NextResponse.json(
			{ error: "providerId query param required" },
			{ status: 400 },
		);
	}

	// Check DCR file first, then fall back to env/default client ID
	const dcrClientId = readDcrClientId(providerId);
	if (dcrClientId) {
		return NextResponse.json({
			registered: true,
			client_id: dcrClientId,
			source: "dcr",
		});
	}

	const envClientId = resolveEnvClientId(providerId);
	if (envClientId) {
		return NextResponse.json({
			registered: true,
			client_id: envClientId,
			source: "preset",
		});
	}

	return NextResponse.json({ registered: false });
}

export async function POST(request: Request) {
	const body = await request.json();
	const providerId = body.providerId as string;
	const clientName = body.clientName as string;
	const scopes = body.scopes as string;

	if (!providerId || !clientName || !scopes) {
		return NextResponse.json(
			{ error: "providerId, clientName, and scopes are required" },
			{ status: 400 },
		);
	}

	const redirectUri = `${appUrl}/api/auth/oauth2/callback/zentity-${providerId}`;

	const response = await fetch(`${zentityUrl}/api/auth/oauth2/register`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: clientName,
			redirect_uris: [redirectUri],
			scope: scopes,
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code"],
			response_types: ["code"],
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		return NextResponse.json(
			{ error: `DCR failed: ${text}` },
			{ status: response.status },
		);
	}

	const result = (await response.json()) as { client_id: string };

	const dataDir = join(process.cwd(), ".data");
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}
	writeFileSync(
		dcrPath(providerId),
		JSON.stringify({ client_id: result.client_id }),
	);

	return NextResponse.json({
		client_id: result.client_id,
		redirect_uri: redirectUri,
	});
}

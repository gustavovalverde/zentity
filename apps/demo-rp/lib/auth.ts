import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import Database from "better-sqlite3";

const zentityUrl = process.env.ZENTITY_URL || "http://localhost:3000";
const zentityUserInfoUrl = new URL(
	"/api/auth/oauth2/userinfo",
	zentityUrl,
).toString();

const dbPath = process.env.DATABASE_PATH || ".data/demo-rp.db";
mkdirSync(dirname(dbPath), { recursive: true });

// Auto-create tables so deleting the DB file "just works"
function ensureTables() {
	const db = new Database(dbPath);
	const hasUsers = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='user'",
		)
		.get();
	if (!hasUsers) {
		db.pragma("journal_mode = WAL");
		db.prepare(
			`CREATE TABLE user (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT NOT NULL,
				emailVerified INTEGER NOT NULL DEFAULT 0,
				image TEXT,
				createdAt TEXT NOT NULL DEFAULT (datetime('now')),
				updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
				claims TEXT
			)`,
		).run();
		db.prepare(
			`CREATE TABLE session (
				id TEXT PRIMARY KEY,
				expiresAt TEXT NOT NULL,
				token TEXT NOT NULL UNIQUE,
				createdAt TEXT NOT NULL DEFAULT (datetime('now')),
				updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
				ipAddress TEXT,
				userAgent TEXT,
				userId TEXT NOT NULL REFERENCES user(id)
			)`,
		).run();
		db.prepare(
			`CREATE TABLE account (
				id TEXT PRIMARY KEY,
				accountId TEXT NOT NULL,
				providerId TEXT NOT NULL,
				userId TEXT NOT NULL REFERENCES user(id),
				accessToken TEXT,
				refreshToken TEXT,
				idToken TEXT,
				accessTokenExpiresAt TEXT,
				refreshTokenExpiresAt TEXT,
				scope TEXT,
				password TEXT,
				createdAt TEXT NOT NULL DEFAULT (datetime('now')),
				updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
		).run();
		db.prepare(
			`CREATE TABLE verification (
				id TEXT PRIMARY KEY,
				identifier TEXT NOT NULL,
				value TEXT NOT NULL,
				expiresAt TEXT NOT NULL,
				createdAt TEXT NOT NULL DEFAULT (datetime('now')),
				updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
		).run();
	}
	db.close();
}
ensureTables();

const PROVIDER_IDS = ["bank", "exchange", "wine", "aid", "veripass"] as const;

function envClientId(key: string): string | null {
	const value = process.env[key]?.trim();
	return value || null;
}

function readDcrClientId(providerId: string): string | null {
	const path = join(process.cwd(), ".data", `dcr-${providerId}.json`);
	if (!existsSync(path)) return null;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof data.client_id === "string") return data.client_id;
	} catch {
		/* corrupted file — fall through */
	}
	return null;
}

const ENV_CLIENT_KEYS: Record<string, string> = {
	bank: "ZENTITY_BANK_CLIENT_ID",
	exchange: "ZENTITY_EXCHANGE_CLIENT_ID",
	wine: "ZENTITY_WINE_CLIENT_ID",
	aid: "ZENTITY_AID_CLIENT_ID",
	veripass: "ZENTITY_VERIPASS_CLIENT_ID",
};

function resolveClientId(providerId: string): string {
	const dcrId = readDcrClientId(providerId);
	if (dcrId) return dcrId;
	const envKey = ENV_CLIENT_KEYS[providerId];
	if (envKey) {
		const envId = envClientId(envKey);
		if (envId) return envId;
	}
	// Placeholder — sign-in button stays disabled until DCR succeeds
	return `pending-dcr-${providerId}`;
}

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
	const parts = idToken.split(".");
	if (parts.length !== 3) return {};
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
	} catch {
		return {};
	}
}

// Fields from Zentity's user model that don't exist in demo-rp's schema.
// If these leak into the profile, better-auth tries to persist them and the
// SQL UPDATE fails with "no such column".
const STRIP_FIELDS = new Set([
	"is_anonymous",
	"isAnonymous",
	"two_factor_enabled",
	"twoFactorEnabled",
	"passwordless_signup",
	"passwordlessSignup",
]);

function stripProviderFields(obj: Record<string, unknown>) {
	for (const key of STRIP_FIELDS) {
		delete obj[key];
	}
	return obj;
}

async function fetchUserInfo(tokens: {
	accessToken?: string;
	idToken?: string;
}) {
	if (!tokens.accessToken) {
		throw new Error("No access token received from Zentity");
	}
	const response = await fetch(zentityUserInfoUrl, {
		headers: { Authorization: `Bearer ${tokens.accessToken}` },
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch Zentity userinfo (${response.status})`);
	}
	const raw = (await response.json()) as Record<string, unknown>;
	const body =
		raw.response && typeof raw.response === "object"
			? (raw.response as Record<string, unknown>)
			: raw;
	const id =
		(typeof body.sub === "string" && body.sub) ||
		(typeof body.id === "string" && body.id);
	if (!id) {
		throw new Error("Zentity userinfo response missing sub/id");
	}
	const profile: Record<string, unknown> = {
		...body,
		id,
		emailVerified: Boolean(body.email_verified),
	};
	if (tokens.idToken) {
		const idTokenClaims = decodeIdTokenPayload(tokens.idToken);
		Object.assign(profile, idTokenClaims);
	}
	stripProviderFields(profile);
	return { id, profile };
}

function findUserIdByAccountId(accountId: string): string | null {
	try {
		const db = new Database(dbPath);
		const row = db
			.prepare("SELECT userId FROM account WHERE accountId = ? LIMIT 1")
			.get(accountId) as { userId: string } | undefined;
		return row?.userId ?? null;
	} catch {
		return null;
	}
}

function readExistingClaims(
	accountId: string,
): Record<string, Record<string, unknown>> {
	try {
		const userId = findUserIdByAccountId(accountId);
		if (!userId) return {};
		const db = new Database(dbPath);
		const user = db
			.prepare("SELECT claims FROM user WHERE id = ?")
			.get(userId) as { claims: string } | undefined;
		if (user?.claims) {
			return JSON.parse(user.claims);
		}
	} catch {
		/* non-fatal */
	}
	return {};
}

function syncClaimsToDb(
	accountId: string,
	providerId: string,
	profile: Record<string, unknown>,
) {
	try {
		const userId = findUserIdByAccountId(accountId);
		if (!userId) return;
		const db = new Database(dbPath);
		const existing = db
			.prepare("SELECT claims FROM user WHERE id = ?")
			.get(userId) as { claims: string } | undefined;
		const allClaims = existing?.claims ? JSON.parse(existing.claims) : {};
		allClaims[providerId] = { ...allClaims[providerId], ...profile };
		db.prepare("UPDATE user SET claims = ? WHERE id = ?").run(
			JSON.stringify(allClaims),
			userId,
		);
	} catch {
		/* non-fatal */
	}
}

function makeProviderConfig(
	providerId: string,
	clientId: string,
	scopes: string[],
) {
	return {
		providerId,
		discoveryUrl: `${zentityUrl}/.well-known/openid-configuration`,
		clientId,
		scopes,
		pkce: true,
		overrideUserInfo: true,
		async getUserInfo(tokens: { accessToken?: string; idToken?: string }) {
			const { id, profile } = await fetchUserInfo(tokens);
			// Direct DB merge for step-up (mapProfileToUser won't run for existing accounts)
			syncClaimsToDb(id, providerId, profile);
			// Attach existing claims so mapProfileToUser can merge (new accounts / account linking)
			profile.__existingClaims = readExistingClaims(id);
			return profile as { id: string; emailVerified: boolean };
		},
		async mapProfileToUser(profile: Record<string, unknown>) {
			const existingClaims = (profile.__existingClaims ?? {}) as Record<
				string,
				Record<string, unknown>
			>;
			const { __existingClaims: _, ...cleanProfile } = profile;

			const subject =
				(typeof profile.sub === "string" && profile.sub) ||
				(typeof profile.id === "string" && profile.id) ||
				undefined;
			const name =
				(profile.name as string) ||
				[profile.given_name, profile.family_name]
					.filter(Boolean)
					.join(" ")
					.trim() ||
				(profile.preferred_username as string) ||
				subject ||
				"Zentity user";
			const email =
				(profile.email as string) ||
				(subject ? `${subject}@zentity.local` : "unknown@zentity.local");
			return {
				name,
				email,
				emailVerified: profile.email_verified as boolean,
				image: profile.picture as string,
				claims: {
					...existingClaims,
					[providerId]: { ...existingClaims[providerId], ...cleanProfile },
				},
			};
		},
	};
}

function createAuth() {
	return betterAuth({
		database: new Database(dbPath),
		baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3102",
		secret:
			process.env.BETTER_AUTH_SECRET || "demo-rp-secret-at-least-32-chars",
		account: {
			accountLinking: {
				trustedProviders: [
					"zentity-bank",
					"zentity-exchange",
					"zentity-wine",
					"zentity-aid",
					"zentity-veripass",
				],
			},
		},
		advanced: {
			cookiePrefix: "demo-rp",
		},
		user: {
			additionalFields: {
				claims: { type: "json", required: false },
			},
		},
		plugins: [
			nextCookies(),
			genericOAuth({
				config: [
					makeProviderConfig("zentity-bank", resolveClientId("bank"), [
						"openid",
						"email",
						"proof:verification",
					]),
					makeProviderConfig("zentity-exchange", resolveClientId("exchange"), [
						"openid",
						"email",
						"proof:verification",
					]),
					makeProviderConfig("zentity-wine", resolveClientId("wine"), [
						"openid",
						"email",
						"proof:age",
					]),
					makeProviderConfig("zentity-aid", resolveClientId("aid"), [
						"openid",
						"email",
						"proof:verification",
					]),
					makeProviderConfig(
						"zentity-veripass",
						resolveClientId("veripass"),
						["openid", "email", "proof:verification"],
					),
				],
			}),
		],
	});
}

// Cached singleton — recreated when any DCR client_id changes.
// getAuth() reads the tiny DCR JSON files on each call and recreates only if needed.
let _instance: ReturnType<typeof createAuth> | null = null;
let _cachedClientIds: string | undefined;

function currentClientIdKey(): string {
	return PROVIDER_IDS.map((id) => `${id}:${readDcrClientId(id) ?? ""}`).join(
		"|",
	);
}

export function getAuth() {
	const key = currentClientIdKey();
	if (!_instance || key !== _cachedClientIds) {
		_cachedClientIds = key;
		_instance = createAuth();
	}
	return _instance;
}

/** Static export for better-auth CLI (migrations/schema introspection). */
export const auth = getAuth();

export type Session = typeof auth.$Infer.Session;

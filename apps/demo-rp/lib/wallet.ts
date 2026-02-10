import { SDJwtInstance } from "@sd-jwt/core";

const STORAGE_KEY = "veripass:credential";

export type StoredCredential = {
	credential: string;
	issuer: string;
	holderPublicJwk: JsonWebKey;
	holderPrivateJwk: JsonWebKey;
	createdAt: number;
};

const hasher = async (data: string | ArrayBuffer): Promise<Uint8Array> => {
	const buffer =
		typeof data === "string" ? new TextEncoder().encode(data) : data;
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return new Uint8Array(digest);
};

const sdjwt = new SDJwtInstance({ hasher });

export function saveCredential(stored: StoredCredential): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function loadCredential(): StoredCredential | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as StoredCredential;
	} catch {
		return null;
	}
}

export function clearCredential(): void {
	localStorage.removeItem(STORAGE_KEY);
}

export async function decodeClaims(
	credential: string,
): Promise<Record<string, unknown>> {
	return (await sdjwt.getClaims(credential)) as Record<string, unknown>;
}

export async function getPresentableKeys(
	credential: string,
): Promise<string[]> {
	const keys = await sdjwt.presentableKeys(credential);
	// Filter out JWT metadata keys
	const metaKeys = new Set([
		"iss",
		"sub",
		"aud",
		"exp",
		"iat",
		"nbf",
		"jti",
		"cnf",
		"vct",
		"status",
		"_sd_alg",
	]);
	return keys.filter((k) => !metaKeys.has(k));
}

export async function createPresentation(
	credential: string,
	selectedKeys: string[],
): Promise<string> {
	const frame: Record<string, boolean> = {};
	for (const key of selectedKeys) {
		frame[key] = true;
	}
	return sdjwt.present(credential, frame);
}

export async function verifyPresentation(
	presentation: string,
): Promise<Record<string, unknown>> {
	return (await sdjwt.getClaims(presentation)) as Record<string, unknown>;
}

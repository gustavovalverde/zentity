/**
 * walt.id Wallet API Client
 *
 * Provides integration with walt.id's wallet-api for interoperability testing.
 * This client enables sending OIDC4VCI credential offers to a walt.id wallet
 * and querying stored credentials.
 */

const WALTID_API_URL =
  process.env.WALTID_WALLET_API_URL ?? "http://localhost:7001";

export type WaltidWallet = {
  id: string;
  name: string;
  createdOn: string;
};

export type WaltidCredential = {
  id: string;
  format: string;
  wallet: string;
  addedOn: string;
  deletedOn?: string;
  document: string;
  disclosures?: string;
  manifest?: string;
};

export type WaltidAccount = {
  id: string;
  username?: string;
  email: string;
  createdOn: string;
};

/**
 * Create a new user account in walt.id wallet
 */
export async function createWaltidAccount(
  email: string,
  password: string
): Promise<{ token: string; id: string } | null> {
  const res = await fetch(`${WALTID_API_URL}/wallet-api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: email.split("@")[0],
      email,
      password,
      type: "email",
    }),
  });

  if (!res.ok) {
    console.error("Failed to create walt.id account:", await res.text());
    return null;
  }

  const data = (await res.json()) as { token?: string; id?: string };
  return data.token && data.id ? { token: data.token, id: data.id } : null;
}

/**
 * Login to walt.id wallet
 */
export async function loginWaltid(
  email: string,
  password: string
): Promise<{ token: string; id: string } | null> {
  const res = await fetch(`${WALTID_API_URL}/wallet-api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      type: "email",
    }),
  });

  if (!res.ok) {
    console.error("Failed to login to walt.id:", await res.text());
    return null;
  }

  const data = (await res.json()) as { token?: string; id?: string };
  return data.token && data.id ? { token: data.token, id: data.id } : null;
}

/**
 * Get or create a wallet for the authenticated user
 */
export async function getOrCreateWaltidWallet(
  token: string
): Promise<WaltidWallet | null> {
  // First, try to list existing wallets
  const listRes = await fetch(`${WALTID_API_URL}/wallet-api/wallet/accounts/wallets`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (listRes.ok) {
    const wallets = (await listRes.json()) as { wallets?: WaltidWallet[] };
    if (wallets.wallets && wallets.wallets.length > 0) {
      return wallets.wallets[0];
    }
  }

  // Create a new wallet if none exists
  const createRes = await fetch(`${WALTID_API_URL}/wallet-api/wallet/accounts/wallets/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Demo Wallet" }),
  });

  if (!createRes.ok) {
    console.error("Failed to create walt.id wallet:", await createRes.text());
    return null;
  }

  return (await createRes.json()) as WaltidWallet;
}

/**
 * Send a credential offer to walt.id wallet using OIDC4VCI exchange
 *
 * @param token - Authentication token
 * @param walletId - The wallet ID to receive the credential
 * @param credentialOffer - The credential offer (can be URI or inline JSON)
 */
export async function sendOfferToWaltid(
  token: string,
  walletId: string,
  credentialOffer: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `${WALTID_API_URL}/wallet-api/wallet/${walletId}/exchange/useOfferRequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: credentialOffer,
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Failed to send offer to walt.id:", errorText);
    return { success: false, error: errorText };
  }

  return { success: true };
}

/**
 * List credentials stored in a walt.id wallet
 */
export async function listWaltidCredentials(
  token: string,
  walletId: string
): Promise<WaltidCredential[]> {
  const res = await fetch(
    `${WALTID_API_URL}/wallet-api/wallet/${walletId}/credentials`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    console.error("Failed to list walt.id credentials:", await res.text());
    return [];
  }

  return (await res.json()) as WaltidCredential[];
}

/**
 * Get a specific credential from walt.id wallet
 */
export async function getWaltidCredential(
  token: string,
  walletId: string,
  credentialId: string
): Promise<WaltidCredential | null> {
  const res = await fetch(
    `${WALTID_API_URL}/wallet-api/wallet/${walletId}/credentials/${credentialId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    console.error("Failed to get walt.id credential:", await res.text());
    return null;
  }

  return (await res.json()) as WaltidCredential;
}

/**
 * Check if walt.id wallet API is healthy
 */
export async function checkWaltidHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${WALTID_API_URL}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Build a credential offer URI from offer JSON
 */
export function buildCredentialOfferUri(
  offer: Record<string, unknown>
): string {
  return `openid-credential-offer://?credential_offer=${encodeURIComponent(
    JSON.stringify(offer)
  )}`;
}

import crypto from "node:crypto";

const ZENTITY_BASE_URL =
  process.env.ZENTITY_BASE_URL ?? "http://localhost:3000";
const AUTH_BASE_URL = `${ZENTITY_BASE_URL}/api/auth`;

const DEMO_SUBJECT_EMAIL =
  process.env.DEMO_SUBJECT_EMAIL ?? "demo-subject@zentity.dev";
const DEMO_SUBJECT_PASSWORD =
  process.env.DEMO_SUBJECT_PASSWORD ?? "demo-subject-password";
const DEMO_ISSUER_EMAIL =
  process.env.DEMO_ISSUER_EMAIL ?? DEMO_SUBJECT_EMAIL;
const DEMO_ISSUER_PASSWORD =
  process.env.DEMO_ISSUER_PASSWORD ?? DEMO_SUBJECT_PASSWORD;

const DEFAULT_ORIGIN =
  process.env.NEXT_PUBLIC_DEMO_HUB_URL ?? "http://localhost:3100";

type Session = {
  cookieHeader: string;
  userId: string;
  email: string;
};

type SessionCache = {
  issuer?: Session;
  subject?: Session;
  walletClientId?: string;
};

const cache: SessionCache = {};

function getSetCookieHeaders(res: Response): string[] {
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [];
  if (cookies.length) {
    return cookies;
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) {
    return [];
  }
  return raw.split(/,(?=[^;]+=[^;]+)/g);
}

function toCookieHeader(cookies: string[]) {
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function postJson(path: string, body: Record<string, unknown>, cookies?: string) {
  const res = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: DEFAULT_ORIGIN,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function getSessionUser(cookieHeader: string) {
  const res = await fetch(`${AUTH_BASE_URL}/get-session`, {
    headers: {
      Origin: DEFAULT_ORIGIN,
      Cookie: cookieHeader,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to get session: ${res.status}`);
  }
  const payload = (await res.json()) as {
    user?: { id?: string; email?: string | null } | null;
  };
  const userId = payload.user?.id;
  if (!userId) {
    throw new Error("Session missing user id");
  }
  return { userId, email: payload.user?.email ?? "" };
}

async function signIn(email: string, password: string): Promise<Session | null> {
  const res = await postJson("/sign-in/email", { email, password });
  if (!res.ok) {
    return null;
  }
  const cookies = getSetCookieHeaders(res);
  const cookieHeader = toCookieHeader(cookies);
  const { userId, email: resolvedEmail } = await getSessionUser(cookieHeader);
  return { cookieHeader, userId, email: resolvedEmail || email };
}

async function bootstrapUser(email: string, password: string) {
  const secret = process.env.DEMO_SEED_SECRET;
  if (!secret) {
    throw new Error("DEMO_SEED_SECRET is not configured");
  }
  const res = await fetch(`${ZENTITY_BASE_URL}/api/demo/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-demo-secret": secret,
      Origin: DEFAULT_ORIGIN,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bootstrap failed: ${text}`);
  }
}

async function ensureAccount(
  email: string,
  password: string
): Promise<Session> {
  await bootstrapUser(email, password);
  const session = await signIn(email, password);
  if (!session) {
    throw new Error(`Unable to authenticate ${email}`);
  }
  return session;
}

export async function ensureIssuerSession(): Promise<Session> {
  if (cache.issuer) {
    return cache.issuer;
  }
  const session = await ensureAccount(DEMO_ISSUER_EMAIL, DEMO_ISSUER_PASSWORD);
  cache.issuer = session;
  return session;
}

export async function ensureSubjectSession(): Promise<Session> {
  if (cache.subject) {
    return cache.subject;
  }
  const session = await ensureAccount(DEMO_SUBJECT_EMAIL, DEMO_SUBJECT_PASSWORD);
  cache.subject = session;
  return session;
}

export async function ensureWalletClientId(): Promise<string> {
  if (cache.walletClientId) {
    return cache.walletClientId;
  }
  const issuer = await ensureIssuerSession();
  const res = await postJson(
    "/oauth2/create-client",
    {
      redirect_uris: ["https://wallet.demo/callback"],
      token_endpoint_auth_method: "none",
      skip_consent: true,
    },
    issuer.cookieHeader
  );
  if (!res.ok) {
    throw new Error(`Failed to create wallet client: ${res.status}`);
  }
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) {
    throw new Error("Missing client_id from wallet client response");
  }
  cache.walletClientId = body.client_id;
  return body.client_id;
}

export async function createCredentialOffer(
  credentialConfigurationId: string
): Promise<{
  issuer: string;
  offer: Record<string, unknown>;
}> {
  const issuerSession = await ensureIssuerSession();
  const subject = await ensureSubjectSession();
  const walletClientId = await ensureWalletClientId();

  const res = await postJson(
    "/oidc4vci/credential-offer",
    {
      client_id: walletClientId,
      userId: subject.userId,
      credential_configuration_id: credentialConfigurationId,
    },
    issuerSession.cookieHeader
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create credential offer: ${text}`);
  }

  const body = (await res.json()) as {
    credential_offer?: Record<string, unknown>;
  };
  if (!body.credential_offer) {
    throw new Error("Missing credential_offer from issuer");
  }
  return { issuer: ZENTITY_BASE_URL, offer: body.credential_offer };
}

export async function verifyPresentation(
  vpToken: string,
  nonce?: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${AUTH_BASE_URL}/oidc4vp/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: DEFAULT_ORIGIN,
    },
    body: JSON.stringify(
      nonce ? { vp_token: vpToken, nonce } : { vp_token: vpToken }
    ),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload;
}

export async function seedDemoIdentity(): Promise<void> {
  await ensureSubjectSession();
  const secret = process.env.DEMO_SEED_SECRET;
  if (!secret) {
    throw new Error("DEMO_SEED_SECRET is not configured");
  }
  const res = await fetch(`${ZENTITY_BASE_URL}/api/demo/seed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-demo-secret": secret,
      Origin: DEFAULT_ORIGIN,
    },
    body: JSON.stringify({ email: DEMO_SUBJECT_EMAIL }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seed failed: ${text}`);
  }
}

export async function fetchDemoStatus(): Promise<Record<string, unknown>> {
  const secret = process.env.DEMO_SEED_SECRET;
  if (!secret) {
    throw new Error("DEMO_SEED_SECRET is not configured");
  }
  const url = new URL(`${ZENTITY_BASE_URL}/api/demo/status`);
  url.searchParams.set("email", DEMO_SUBJECT_EMAIL);
  const res = await fetch(url.toString(), {
    headers: {
      "x-demo-secret": secret,
      Origin: DEFAULT_ORIGIN,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Status failed: ${text}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export function getScenarioNonce() {
  return crypto.randomUUID();
}

export const demoSubjectEmail = DEMO_SUBJECT_EMAIL;

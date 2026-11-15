import "server-only";

import { resolve } from "node:path";
import { and, eq, gt, isNull } from "drizzle-orm";
import { exportJWK, generateKeyPair } from "jose";
import { getDb } from "@/lib/db/connection";
import { vpSessions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { signAuthorizationRequest } from "@/lib/jar";
import {
  getVerifierClientId,
  loadCertChain,
  loadLeafKeyPem,
  loadLeafPem,
} from "@/lib/x509";
import { VERIFIER_SCENARIOS } from "@/scenarios/veripass/verifier-registry";

const VP_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface VpSession {
  authorizationUri: string;
  sessionId: string;
}

function getCertDir(): string {
  const configured = env.VERIFIER_CERT_PATH;
  if (configured.startsWith("/")) {
    return configured;
  }
  return resolve(process.cwd(), configured);
}

export async function createVpSession(
  scenarioId: string,
  sessionCookie: string | null
): Promise<VpSession> {
  const scenario = VERIFIER_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const certDir = getCertDir();
  const leafPem = loadLeafPem(certDir);
  const leafKeyPem = loadLeafKeyPem(certDir);
  const x5cChain = loadCertChain(certDir);

  if (!(leafPem && leafKeyPem && x5cChain)) {
    throw new Error(
      "Verifier certificates not found. Run: pnpm exec tsx scripts/generate-dev-certs.ts"
    );
  }

  // Generate ephemeral ECDH-ES P-256 keypair for response encryption
  const { privateKey, publicKey } = await generateKeyPair("ECDH-ES", {
    crv: "P-256",
    extractable: true,
  });
  const ephemeralPublicJwk = await exportJWK(publicKey);
  ephemeralPublicJwk.use = "enc";
  ephemeralPublicJwk.kid = crypto.randomUUID();
  const ephemeralPrivateJwk = await exportJWK(privateKey);

  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const state = crypto.randomUUID();
  const clientId = getVerifierClientId(leafPem);
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  const requestParams: Record<string, unknown> = {
    response_type: "vp_token",
    response_mode: "direct_post.jwt",
    client_id: clientId,
    dcql_query: scenario.dcqlQuery,
    nonce,
    state,
    response_uri: `${appUrl}/api/oid4vp/response`,
    client_metadata: {
      jwks: { keys: [ephemeralPublicJwk] },
    },
  };

  // Sign as JAR JWT
  const signedRequest = await signAuthorizationRequest(
    requestParams,
    leafKeyPem,
    x5cChain
  );

  const requestUri = `${appUrl}/api/oid4vp/request?session_id=${sessionId}`;
  const authorizationUri = `openid4vp://?request_uri=${encodeURIComponent(requestUri)}&client_id=${encodeURIComponent(clientId)}`;

  // Store session
  const db = getDb();
  const now = new Date();
  await db.insert(vpSessions).values({
    id: sessionId,
    nonce,
    state,
    dcqlQuery: JSON.stringify(scenario.dcqlQuery),
    signedRequest,
    status: "pending",
    encryptionKey: JSON.stringify(ephemeralPrivateJwk),
    sessionCookie,
    scenarioId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + VP_TTL_MS),
  });

  return { sessionId, authorizationUri };
}

/**
 * Returns the session's signed request object to the first fetch before the
 * session expires, and null to every other fetch.
 */
export async function consumeSignedRequest(
  sessionId: string
): Promise<string | null> {
  const now = new Date();
  const [fetched] = await getDb()
    .update(vpSessions)
    .set({ requestFetchedAt: now })
    .where(
      and(
        eq(vpSessions.id, sessionId),
        isNull(vpSessions.requestFetchedAt),
        gt(vpSessions.expiresAt, now)
      )
    )
    .returning({ signedRequest: vpSessions.signedRequest });
  return fetched?.signedRequest ?? null;
}

export function getVpSession(sessionId: string) {
  const db = getDb();
  return db.select().from(vpSessions).where(eq(vpSessions.id, sessionId)).get();
}

export function getVpSessionByState(state: string) {
  const db = getDb();
  return db.select().from(vpSessions).where(eq(vpSessions.state, state)).get();
}

export async function updateVpSession(
  sessionId: string,
  updates: {
    status?: "pending" | "verified" | "expired" | "failed";
    result?: string;
  }
) {
  const db = getDb();
  await db.update(vpSessions).set(updates).where(eq(vpSessions.id, sessionId));
}

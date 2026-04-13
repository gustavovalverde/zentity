import "server-only";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { decodeJwt } from "jose";

import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "./opaque-access-token";

// ---------------------------------------------------------------------------
// DPoP nonce store (RFC 9449 §8)
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 60_000;

class DpopNonceStore {
  private readonly nonces = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlSeconds?: number) {
    this.ttlMs = (ttlSeconds ?? 30) * 1000;
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  issue(): string {
    const nonce = crypto.randomUUID();
    this.nonces.set(nonce, Date.now() + this.ttlMs);
    return nonce;
  }

  validate(nonce: string): boolean {
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt === undefined) {
      return false;
    }
    this.nonces.delete(nonce);
    return Date.now() < expiresAt;
  }

  private sweep() {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (now >= expiresAt) {
        this.nonces.delete(nonce);
      }
    }
  }
}

let instance: DpopNonceStore | undefined;

export function getDpopNonceStore(ttlSeconds?: number): DpopNonceStore {
  if (!instance) {
    instance = new DpopNonceStore(ttlSeconds);
  }
  return instance;
}

// ---------------------------------------------------------------------------
// DPoP → Bearer rewrite for userinfo endpoint
// ---------------------------------------------------------------------------

const validateDpop = createDpopAccessTokenValidator({ requireDpop: false });

/**
 * Rewrite `Authorization: DPoP <token>` to `Authorization: Bearer <token>`
 * after validating the DPoP proof. Bridges the gap between RFC 9449 DPoP
 * clients and better-auth's userinfo endpoint which only parses Bearer.
 *
 * Bearer requests pass through unchanged. DPoP requests decode the JWT,
 * validate the proof (enforces cnf.jkt binding when present), then rewrite.
 */
export async function rewriteDpopForUserinfo(
  request: Request
): Promise<Request> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("DPoP ")) {
    return request;
  }

  const token = authorization.slice(5);

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = decodeJwt(token) as Record<string, unknown>;
  } catch {
    const opaqueToken = await loadOpaqueAccessToken(token);
    if (opaqueToken?.dpopJkt) {
      const validDpop = await validateOpaqueAccessTokenDpop(
        request,
        opaqueToken.dpopJkt
      );
      if (!validDpop) {
        throw new Error("Invalid DPoP proof");
      }
    }
    return rewriteBearer(request, token);
  }

  await validateDpop({ request, tokenPayload });

  return rewriteBearer(request, token);
}

function rewriteBearer(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers });
}

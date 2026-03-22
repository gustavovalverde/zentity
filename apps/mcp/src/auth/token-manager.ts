import { config } from "../config.js";
import {
  clearClientRegistration,
  clearTokenCredentials,
  loadCredentials,
  updateCredentials,
} from "./credentials.js";
import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

const PROACTIVE_REFRESH_MS = 60_000;

interface RefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type: string;
}

export class TokenManager {
  private readonly tokenEndpoint: string;
  private readonly dpopKey: DpopKeyPair;
  private readonly clientId: string;
  private readonly resource: string | undefined;
  private dpopNonce: string | undefined;

  constructor(
    tokenEndpoint: string,
    dpopKey: DpopKeyPair,
    clientId: string,
    resource?: string
  ) {
    this.tokenEndpoint = tokenEndpoint;
    this.dpopKey = dpopKey;
    this.clientId = clientId;
    this.resource = resource;
  }

  getAccessToken(): Promise<string> {
    const creds = loadCredentials(config.zentityUrl);
    if (creds?.accessToken && !this.isExpiringSoon(creds.expiresAt)) {
      return Promise.resolve(creds.accessToken);
    }

    if (creds?.refreshToken) {
      return this.refreshTokens(creds.refreshToken);
    }

    throw new TokenExpiredError();
  }

  private isExpiringSoon(expiresAt?: number): boolean {
    if (!expiresAt) {
      return true;
    }
    return Date.now() + PROACTIVE_REFRESH_MS >= expiresAt;
  }

  private async refreshTokens(refreshToken: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    if (this.resource) {
      body.set("resource", this.resource);
    }

    let dpopProof = await createDpopProof(
      this.dpopKey,
      "POST",
      this.tokenEndpoint,
      undefined,
      this.dpopNonce
    );

    let response = await fetch(this.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body,
    });

    // DPoP nonce retry
    const newNonce = extractDpopNonce(response);
    if (
      newNonce &&
      this.dpopNonce !== newNonce &&
      (response.status === 400 || response.status === 401)
    ) {
      this.dpopNonce = newNonce;
      dpopProof = await createDpopProof(
        this.dpopKey,
        "POST",
        this.tokenEndpoint,
        undefined,
        this.dpopNonce
      );
      response = await fetch(this.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: dpopProof,
        },
        body,
      });
    }

    if (this.dpopNonce !== newNonce) {
      this.dpopNonce = newNonce ?? this.dpopNonce;
    }

    if (!response.ok) {
      const text = await response.text();
      if (text.includes("invalid_client") || text.includes("client not found")) {
        clearClientRegistration(config.zentityUrl);
        throw new TokenExpiredError();
      }
      if (text.includes("invalid_grant")) {
        clearTokenCredentials(config.zentityUrl);
        throw new TokenExpiredError();
      }
      throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as RefreshResponse;
    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

    updateCredentials(config.zentityUrl, {
      accessToken: data.access_token,
      expiresAt,
      refreshToken: data.refresh_token ?? refreshToken,
    });

    return data.access_token;
  }
}

export class TokenExpiredError extends Error {
  constructor() {
    super("No valid credentials — re-authentication required");
    this.name = "TokenExpiredError";
  }
}

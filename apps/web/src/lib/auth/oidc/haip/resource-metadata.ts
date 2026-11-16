import "server-only";

import type { OAuthResourceInput } from "@better-auth/oauth-provider";

import { APIError } from "better-auth/api";

import { env } from "@/env";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";

const TRAILING_SLASHES = /\/+$/;

/** A resource identifier in its registered form, without trailing slashes. */
export function normalizeResource(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

// ---------------------------------------------------------------------------
// RFC 9728 — OAuth Protected Resource metadata
// ---------------------------------------------------------------------------

interface ProtectedResourceConfig {
  appUrl: string;
  authIssuer: string;
  mcpPublicUrl: string;
  oidc4vciCredentialAudience: string;
  rpApiAudience: string;
  /**
   * The agent wallet's audience: an absolute-URI wallet identity (e.g.
   * `urn:zentity:wallet:<jkt>`). Seeded as a resource so a
   * payment_authorization token request can pin `aud` to the wallet via the
   * resource indicator (PRD-43 D-5). A URN carries no trailing slash, so
   * normalization is a no-op and the emitted `aud` equals this value verbatim.
   */
  walletAudience?: string | undefined;
}

/** A payment token lives two minutes, so a leaked one is short-lived. */
const WALLET_ACCESS_TOKEN_TTL_SECONDS = 120;

export function getProtectedResourceAudiences(
  config: ProtectedResourceConfig
): Array<string | OAuthResourceInput> {
  const raw = [
    config.appUrl,
    config.authIssuer,
    config.mcpPublicUrl,
    config.oidc4vciCredentialAudience,
    config.rpApiAudience,
  ];
  const present = raw.filter((value): value is string => Boolean(value));
  const identifiers = [...new Set(present.map(normalizeResource))];
  if (!config.walletAudience) {
    return identifiers;
  }
  const walletAudience = normalizeResource(config.walletAudience);
  return [
    ...identifiers.filter((identifier) => identifier !== walletAudience),
    {
      identifier: walletAudience,
      accessTokenTtl: WALLET_ACCESS_TOKEN_TTL_SECONDS,
      dpopBoundAccessTokensRequired: true,
    },
  ];
}

/** Whether a resource indicator or audience names the agent wallet. */
function isWalletAudience(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Boolean(env.WALLET_AUDIENCE) &&
    normalizeResource(value) === normalizeResource(env.WALLET_AUDIENCE ?? "")
  );
}

/**
 * Refuses a request that names the wallet audience. Only a CIBA payment
 * request (where the payment pin sets it) and its token poll may.
 */
export function refuseWalletAudience(...values: unknown[]): void {
  if (values.flat().some(isWalletAudience)) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_target",
      error_description: "the wallet audience accepts only payment requests",
    });
  }
}

const zentityOrigins = [
  normalizeResource(env.NEXT_PUBLIC_APP_URL),
  normalizeResource(getAuthIssuer()),
];

/**
 * Whether a resource indicator names an endpoint Zentity serves itself. User
 * access tokens for these endpoints are opaque reference tokens (ADR
 * privacy/0015).
 */
export function isZentityHostedResource(resource: string): boolean {
  const normalized = normalizeResource(resource);
  return zentityOrigins.some(
    (origin) => normalized === origin || normalized.startsWith(`${origin}/`)
  );
}

/**
 * Prepares the resource indicators of a user token request: each one takes the
 * registered form (no trailing slash, so `https://mcp.example/` names
 * `https://mcp.example`), and Zentity-hosted ones are dropped so the OAuth
 * provider issues an opaque token for them. A JWT access token names at most
 * one audience outside Zentity, because its subject is pairwise for that
 * audience (RFC 8707 §2). The wallet audience is refused unless the caller
 * allows it.
 */
export function normalizeUserTokenResources(
  params: Record<string, unknown>,
  options: { allowWalletAudience: boolean }
): void {
  const { resource } = params;
  if (!options.allowWalletAudience) {
    refuseWalletAudience(resource);
  }
  const external = [
    ...new Set(
      (Array.isArray(resource) ? resource : [resource])
        .filter((value): value is string => typeof value === "string")
        .map(normalizeResource)
        .filter((value) => !isZentityHostedResource(value))
    ),
  ];
  if (external.length > 1) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_target",
      error_description: "request one resource outside Zentity per token",
    });
  }
  if (external.length === 0) {
    Reflect.deleteProperty(params, "resource");
  } else {
    params.resource = Array.isArray(resource) ? external : external[0];
  }
}

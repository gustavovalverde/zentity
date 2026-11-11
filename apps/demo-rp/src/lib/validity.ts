import "server-only";

import type { DpopClient } from "@zentity/sdk/rp";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/connection";
import { readDcrClientId } from "@/lib/dcr";
import { env } from "@/lib/env";
import { getOAuthDpopClient } from "@/lib/oauth-dpop-client";
import {
  describeOAuthErrorResponse,
  parseOAuthJsonResponse,
} from "@/lib/oauth-response";
import {
  getOAuthProviderId,
  type RouteScenarioId,
} from "@/scenarios/route-scenario-registry";

import { account, validityNotice } from "./db/schema";

const VALIDITY_PATH = "/api/auth/oauth2/validity";

export const VALIDITY_STATUSES = [
  "pending",
  "verified",
  "failed",
  "revoked",
  "stale",
] as const;

export type ValidityStatus = (typeof VALIDITY_STATUSES)[number];

function toValidityStatus(value: unknown): ValidityStatus {
  return typeof value === "string" &&
    (VALIDITY_STATUSES as readonly string[]).includes(value)
    ? (value as ValidityStatus)
    : "pending";
}

interface RemoteValidityState {
  eventId: string | null;
  eventKind: string | null;
  occurredAt: string | null;
  reason: string | null;
  validityStatus: ValidityStatus;
}

interface StoredValidityNotice {
  clientId: string;
  eventId: string;
  eventKind: string;
  occurredAt: string;
  reason: string | null;
  receivedAt: string;
  validityStatus: ValidityStatus;
}

export interface ScenarioValidityState {
  clientId: string | null;
  latestNotice: StoredValidityNotice | null;
  pullError: string | null;
  scenarioId: RouteScenarioId;
  snapshot: RemoteValidityState | null;
  subject: string | null;
}

async function readScenarioSessionAccount(args: {
  scenarioId: RouteScenarioId;
  userId: string;
}): Promise<{
  accessToken: string | null;
  subject: string;
} | null> {
  return (
    (await getDb()
      .select({
        accessToken: account.accessToken,
        subject: account.accountId,
      })
      .from(account)
      .where(
        and(
          eq(account.providerId, getOAuthProviderId(args.scenarioId)),
          eq(account.userId, args.userId)
        )
      )
      .limit(1)
      .get()) ?? null
  );
}

async function readLatestValidityNotice(args: {
  clientId: string;
  subject: string;
}): Promise<StoredValidityNotice | null> {
  const row = await getDb()
    .select({
      clientId: validityNotice.clientId,
      eventId: validityNotice.eventId,
      eventKind: validityNotice.eventKind,
      occurredAt: validityNotice.occurredAt,
      reason: validityNotice.reason,
      receivedAt: validityNotice.receivedAt,
      scenarioId: validityNotice.scenarioId,
      validityStatus: validityNotice.validityStatus,
    })
    .from(validityNotice)
    .where(
      and(
        eq(validityNotice.clientId, args.clientId),
        eq(validityNotice.sub, args.subject)
      )
    )
    .orderBy(desc(validityNotice.receivedAt))
    .limit(1)
    .get();

  return row
    ? { ...row, validityStatus: toValidityStatus(row.validityStatus) }
    : null;
}

async function fetchRemoteValidityState(args: {
  accessToken: string;
  dpop: DpopClient;
}): Promise<RemoteValidityState> {
  const validityUrl = new URL(VALIDITY_PATH, env.ZENTITY_URL).toString();
  const response = await args.dpop.fetch(validityUrl, {
    accessToken: args.accessToken,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new Error(
      describeOAuthErrorResponse(
        response,
        payload,
        "Issuer validity state request"
      )
    );
  }

  const body = await parseOAuthJsonResponse(
    response,
    "Issuer validity state request"
  );
  return {
    eventId: typeof body.eventId === "string" ? body.eventId : null,
    eventKind: typeof body.eventKind === "string" ? body.eventKind : null,
    occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : null,
    reason: typeof body.reason === "string" ? body.reason : null,
    validityStatus: toValidityStatus(body.validityStatus),
  };
}

export async function getScenarioValidityState(args: {
  scenarioId: RouteScenarioId;
  userId: string;
}): Promise<ScenarioValidityState> {
  const [clientId, sessionAccount] = await Promise.all([
    readDcrClientId(args.scenarioId),
    readScenarioSessionAccount(args),
  ]);

  const subject = sessionAccount?.subject ?? null;
  const accessToken = sessionAccount?.accessToken ?? null;

  const [latestNotice, dpop] = await Promise.all([
    clientId && subject
      ? readLatestValidityNotice({ clientId, subject })
      : Promise.resolve(null),
    accessToken ? getOAuthDpopClient(accessToken) : Promise.resolve(null),
  ]);

  if (!(clientId && accessToken)) {
    return {
      clientId,
      latestNotice,
      scenarioId: args.scenarioId,
      pullError: null,
      snapshot: null,
      subject,
    };
  }

  if (!dpop) {
    return {
      clientId,
      latestNotice,
      scenarioId: args.scenarioId,
      pullError: "Missing DPoP key for current RP session.",
      snapshot: null,
      subject,
    };
  }

  try {
    const snapshot = await fetchRemoteValidityState({ accessToken, dpop });

    return {
      clientId,
      latestNotice,
      scenarioId: args.scenarioId,
      pullError: null,
      snapshot,
      subject,
    };
  } catch (error) {
    return {
      clientId,
      latestNotice,
      scenarioId: args.scenarioId,
      pullError: error instanceof Error ? error.message : String(error),
      snapshot: null,
      subject,
    };
  }
}

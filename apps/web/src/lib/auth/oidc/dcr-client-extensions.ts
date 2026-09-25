import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

interface DcrClientExtensions {
  backchannelTokenDeliveryMode?: string;
  enableEndSession?: boolean;
  protectedResource?: string;
  rpValidityNoticeEnabled?: boolean;
  rpValidityNoticeUri?: string;
}

const PROTECTED_RESOURCE_METADATA_FIELD = "zentity_protected_resource";
const VALID_BACKCHANNEL_DELIVERY_MODES = new Set(["poll", "ping", "push"]);

function parseClientMetadataRecord(
  metadata: string | null
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function readDcrClientExtensions(
  body: Record<string, unknown> | null | undefined
): DcrClientExtensions | null {
  if (!body) {
    return null;
  }

  const enableEndSession =
    Array.isArray(body.post_logout_redirect_uris) &&
    body.post_logout_redirect_uris.length > 0;
  const rpValidityNoticeUri = readTrimmedString(body.rp_validity_notice_uri);
  const rpValidityNoticeEnabled = body.rp_validity_notice_enabled === true;
  const protectedResource = readTrimmedString(
    body[PROTECTED_RESOURCE_METADATA_FIELD]
  );
  const backchannelTokenDeliveryModeRaw = readTrimmedString(
    body.backchannel_token_delivery_mode
  );
  const backchannelTokenDeliveryMode =
    backchannelTokenDeliveryModeRaw &&
    VALID_BACKCHANNEL_DELIVERY_MODES.has(backchannelTokenDeliveryModeRaw)
      ? backchannelTokenDeliveryModeRaw
      : undefined;

  const extensions: DcrClientExtensions = {};
  if (enableEndSession) {
    extensions.enableEndSession = true;
  }
  if (backchannelTokenDeliveryMode) {
    extensions.backchannelTokenDeliveryMode = backchannelTokenDeliveryMode;
  }
  if (rpValidityNoticeUri) {
    extensions.rpValidityNoticeUri = rpValidityNoticeUri;
    extensions.rpValidityNoticeEnabled = true;
  } else if (rpValidityNoticeEnabled) {
    extensions.rpValidityNoticeEnabled = true;
  }
  if (protectedResource) {
    extensions.protectedResource = protectedResource;
  }

  return Object.keys(extensions).length > 0 ? extensions : null;
}

export async function persistDcrClientExtensions(
  clientId: string,
  extensions: DcrClientExtensions
) {
  const existingClient = await db.query.oauthClients.findFirst({
    columns: {
      metadata: true,
    },
    where: eq(oauthClients.clientId, clientId),
  });
  if (!existingClient) {
    return;
  }

  const metadata = parseClientMetadataRecord(existingClient.metadata);
  if (extensions.rpValidityNoticeUri) {
    metadata.rp_validity_notice_uri = extensions.rpValidityNoticeUri;
  }
  if (extensions.rpValidityNoticeEnabled) {
    metadata.rp_validity_notice_enabled = true;
  }
  if (extensions.protectedResource) {
    metadata[PROTECTED_RESOURCE_METADATA_FIELD] = extensions.protectedResource;
  }
  if (extensions.backchannelTokenDeliveryMode) {
    metadata.backchannel_token_delivery_mode =
      extensions.backchannelTokenDeliveryMode;
  }

  await db
    .update(oauthClients)
    .set({
      enableEndSession: extensions.enableEndSession,
      metadata:
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      rpValidityNoticeEnabled:
        extensions.rpValidityNoticeEnabled ||
        Boolean(extensions.rpValidityNoticeUri),
      rpValidityNoticeUri: extensions.rpValidityNoticeUri,
    })
    .where(eq(oauthClients.clientId, clientId))
    .run();
}

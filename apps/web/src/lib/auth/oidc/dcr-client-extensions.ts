import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

interface DcrClientExtensions {
  backchannelLogoutSessionRequired?: boolean;
  backchannelLogoutUri?: string;
  protectedResource?: string;
  rpValidityNoticeEnabled?: boolean;
  rpValidityNoticeUri?: string;
}

const PROTECTED_RESOURCE_METADATA_FIELD = "zentity_protected_resource";

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

  const backchannelLogoutUri = readTrimmedString(body.backchannel_logout_uri);
  const backchannelLogoutSessionRequired =
    body.backchannel_logout_session_required === true;
  const rpValidityNoticeUri = readTrimmedString(body.rp_validity_notice_uri);
  const rpValidityNoticeEnabled = body.rp_validity_notice_enabled === true;
  const protectedResource = readTrimmedString(
    body[PROTECTED_RESOURCE_METADATA_FIELD]
  );

  const extensions: DcrClientExtensions = {};
  if (backchannelLogoutUri) {
    extensions.backchannelLogoutUri = backchannelLogoutUri;
    extensions.backchannelLogoutSessionRequired =
      backchannelLogoutSessionRequired;
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
  if (extensions.backchannelLogoutUri) {
    metadata.backchannel_logout_uri = extensions.backchannelLogoutUri;
    if (extensions.backchannelLogoutSessionRequired) {
      metadata.backchannel_logout_session_required = true;
    } else {
      metadata.backchannel_logout_session_required = undefined;
    }
  }
  if (extensions.rpValidityNoticeUri) {
    metadata.rp_validity_notice_uri = extensions.rpValidityNoticeUri;
  }
  if (extensions.rpValidityNoticeEnabled) {
    metadata.rp_validity_notice_enabled = true;
  }
  if (extensions.protectedResource) {
    metadata[PROTECTED_RESOURCE_METADATA_FIELD] = extensions.protectedResource;
  }

  await db
    .update(oauthClients)
    .set({
      enableEndSession: extensions.backchannelLogoutUri ? true : undefined,
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

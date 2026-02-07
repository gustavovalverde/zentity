import "server-only";

/**
 * Identity Capture at OAuth Consent Time
 *
 * When a user consents to share identity data with an RP, the consent UI
 * decrypts the user's profile secret (credential-wrapped PII vault) and
 * sends the relevant fields to the capture endpoint. This module:
 *
 * 1. Merges client-provided PII with server-side signed claims
 * 2. Encrypts with a server key bound to (userId, clientId)
 * 3. Stores in oauth_identity_data for later userinfo responses
 */

import { getLatestSignedClaimByUserTypeAndDocument } from "@/lib/db/queries/crypto";
import { getLatestIdentityDocumentByUserId } from "@/lib/db/queries/identity";
import { upsertOAuthIdentityData } from "@/lib/db/queries/oauth-identity";
import { logger } from "@/lib/logging/logger";
import { hashIdentifier } from "@/lib/observability/telemetry";
import {
  encryptIdentityForServer,
  type IdentityFields,
} from "@/lib/privacy/server-encryption/identity";

import {
  extractIdentityScopes,
  filterIdentityByScopes,
} from "./identity-scopes";

interface OcrClaimData {
  documentType?: string;
  issuerCountry?: string;
}

/**
 * Capture identity at consent time by merging client-provided PII
 * (from the user's credential-encrypted profile secret) with
 * server-side signed claims, then encrypting per-RP.
 */
export async function captureIdentityWithClientData(
  userId: string,
  clientId: string,
  scopes: string[],
  clientData: Partial<IdentityFields>
): Promise<{ captured: boolean; fieldsCount: number }> {
  const identityScopes = extractIdentityScopes(scopes);

  if (identityScopes.length === 0) {
    return { captured: false, fieldsCount: 0 };
  }

  try {
    // Start with server-side data
    const document = await getLatestIdentityDocumentByUserId(userId);
    const documentId = document?.id ?? null;

    const ocrClaim = documentId
      ? await getLatestSignedClaimByUserTypeAndDocument(
          userId,
          "ocr_result",
          documentId
        )
      : null;

    const identity: IdentityFields = {};

    if (ocrClaim?.claimPayload) {
      try {
        const payload = JSON.parse(ocrClaim.claimPayload) as {
          data?: OcrClaimData;
        };
        if (payload.data?.documentType) {
          identity.document_type = payload.data.documentType;
        }
        if (payload.data?.issuerCountry) {
          identity.issuing_country = payload.data.issuerCountry;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Merge client-provided data (overwrites server data where provided)
    Object.assign(identity, clientData);

    const filteredIdentity = filterIdentityByScopes(identity, scopes);
    if (Object.keys(filteredIdentity).length === 0) {
      return { captured: false, fieldsCount: 0 };
    }

    const encryptedBlob = await encryptIdentityForServer(filteredIdentity, {
      userId,
      clientId,
    });

    await upsertOAuthIdentityData({
      id: crypto.randomUUID(),
      userId,
      clientId,
      encryptedBlob,
      consentedScopes: scopes,
      capturedAt: new Date().toISOString(),
    });

    return {
      captured: true,
      fieldsCount: Object.keys(filteredIdentity).length,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        userId: hashIdentifier(userId),
        clientId: hashIdentifier(clientId),
      },
      "Failed to capture identity with client data"
    );
    throw error;
  }
}

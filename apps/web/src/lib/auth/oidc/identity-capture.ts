import "server-only";

/**
 * Identity Capture at OAuth Consent Time
 *
 * When a user consents to share identity data with an RP, we:
 * 1. Read identity data from signed claims (server has these from verification)
 * 2. Encrypt with server key bound to (userId, clientId)
 * 3. Store for later userinfo responses
 *
 * This module handles step 1-3, called during the consent flow.
 */

import { getLatestSignedClaimByUserTypeAndDocument } from "@/lib/db/queries/crypto";
import {
  getLatestIdentityDocumentByUserId,
  getLatestIdentityDraftByUserId,
} from "@/lib/db/queries/identity";
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

/**
 * OCR claim data structure (from signed claims)
 */
interface OcrClaimData {
  documentType?: string;
  issuerCountry?: string;
}

/**
 * Capture identity data at consent time and store server-encrypted.
 *
 * This reads identity from:
 * - Signed OCR claims (document type, issuer country)
 * - Identity draft (for any transient data captured during verification)
 * - Identity document (for verified metadata)
 *
 * Note: Raw PII like DOB and full name are NOT stored in claims.
 * This function captures what's available from server-side sources.
 * For actual PII, the client would need to provide it at consent time,
 * which is handled separately via the consent UI.
 */
async function _captureIdentityAtConsent(
  userId: string,
  clientId: string,
  scopes: string[]
): Promise<{ captured: boolean; fieldsCount: number }> {
  const identityScopes = extractIdentityScopes(scopes);

  // No identity scopes requested - nothing to capture
  if (identityScopes.length === 0) {
    return { captured: false, fieldsCount: 0 };
  }

  try {
    // Get the user's verified document
    const document = await getLatestIdentityDocumentByUserId(userId);
    const documentId = document?.id ?? null;

    // Parallelize data fetching
    const [ocrClaim, draft] = await Promise.all([
      documentId
        ? getLatestSignedClaimByUserTypeAndDocument(
            userId,
            "ocr_result",
            documentId
          )
        : null,
      getLatestIdentityDraftByUserId(userId),
    ]);

    // Build identity from available sources
    const identity: IdentityFields = {};

    // From OCR signed claim
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
        logger.warn(
          {
            userId: hashIdentifier(userId),
            clientId: hashIdentifier(clientId),
          },
          "Failed to parse OCR claim payload during identity capture"
        );
      }
    }

    // From identity document
    if (document) {
      if (document.documentType) {
        identity.document_type = document.documentType;
      }
      if (document.issuerCountry) {
        identity.issuing_country = document.issuerCountry;
        // Also use as nationality if not explicitly set
        if (!identity.nationality) {
          identity.nationality = document.issuerCountry;
        }
      }
    }

    // From draft (may have additional metadata)
    if (draft?.issuerCountry && !identity.issuing_country) {
      identity.issuing_country = draft.issuerCountry;
    }

    const filteredIdentity = filterIdentityByScopes(identity, scopes);

    // If no identity data available after filtering, skip storage
    if (Object.keys(filteredIdentity).length === 0) {
      logger.info(
        { userId: hashIdentifier(userId), clientId: hashIdentifier(clientId) },
        "No identity data available to capture at consent"
      );
      return { captured: false, fieldsCount: 0 };
    }

    // Encrypt and store
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

    logger.info(
      {
        userId: hashIdentifier(userId),
        clientId: hashIdentifier(clientId),
        fieldsCount: Object.keys(filteredIdentity).length,
        scopes: identityScopes,
      },
      "Identity data captured at consent"
    );

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
      "Failed to capture identity at consent"
    );
    throw error;
  }
}

/**
 * Capture identity with client-provided data.
 *
 * For full PII capture, the client must provide the data at consent time
 * (since the server doesn't store plaintext PII). This function handles
 * that case, merging client-provided data with server-side claims.
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

    // Merge server-side document metadata
    if (document) {
      if (document.documentType) {
        identity.document_type = document.documentType;
      }
      if (document.issuerCountry) {
        identity.issuing_country = document.issuerCountry;
      }
    }

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

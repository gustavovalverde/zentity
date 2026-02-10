import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { storeEphemeralClaims } from "@/lib/auth/oidc/ephemeral-identity-claims";
import {
  createScopeHash,
  verifyIdentityIntentToken,
} from "@/lib/auth/oidc/identity-intent";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
  type IdentityFields,
} from "@/lib/auth/oidc/identity-scopes";
import {
  parseRequestedScopes,
  verifySignedOAuthQuery,
} from "@/lib/auth/oidc/oauth-query";

const IdentityAddressSchema = z
  .object({
    formatted: z.string().optional(),
    street_address: z.string().optional(),
    locality: z.string().optional(),
    region: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
  })
  .strict();

const IdentityFieldsSchema = z
  .object({
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    name: z.string().optional(),
    birthdate: z.string().optional(),
    address: IdentityAddressSchema.optional(),
    document_number: z.string().optional(),
    document_type: z.string().optional(),
    issuing_country: z.string().optional(),
    nationality: z.string().optional(),
    nationalities: z.array(z.string()).optional(),
  })
  .strict();

const StageSchema = z.object({
  oauth_query: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  identity: IdentityFieldsSchema.optional(),
  intent_token: z.string().min(1).optional(),
});

function normalizeIdentityFields(
  identity: Partial<IdentityFields>
): Partial<IdentityFields> {
  const normalized: Partial<IdentityFields> = {};

  const setIfNonEmpty = (key: keyof IdentityFields, value?: string) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        normalized[key] = trimmed as never;
      }
    }
  };

  setIfNonEmpty("given_name", identity.given_name);
  setIfNonEmpty("family_name", identity.family_name);
  setIfNonEmpty("name", identity.name);
  setIfNonEmpty("birthdate", identity.birthdate);
  setIfNonEmpty("document_number", identity.document_number);
  setIfNonEmpty("document_type", identity.document_type);
  setIfNonEmpty("issuing_country", identity.issuing_country);
  setIfNonEmpty("nationality", identity.nationality);

  if (Array.isArray(identity.nationalities)) {
    const filtered = identity.nationalities
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (filtered.length > 0) {
      normalized.nationalities = filtered;
    }
  }

  if (identity.address) {
    const address = {
      formatted: identity.address.formatted?.trim(),
      street_address: identity.address.street_address?.trim(),
      locality: identity.address.locality?.trim(),
      region: identity.address.region?.trim(),
      postal_code: identity.address.postal_code?.trim(),
      country: identity.address.country?.trim(),
    };
    const entries = Object.entries(address).filter(
      ([, value]) => typeof value === "string" && value.length > 0
    );
    if (entries.length > 0) {
      normalized.address = Object.fromEntries(entries);
    }
  }

  return normalized;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = StageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { oauth_query, scopes, identity, intent_token } = parsed.data;

  let queryParams: URLSearchParams;
  try {
    queryParams = await verifySignedOAuthQuery(oauth_query);
  } catch {
    return NextResponse.json({ error: "Invalid OAuth query" }, { status: 400 });
  }

  const clientId = queryParams.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "Missing client_id" }, { status: 400 });
  }

  const requestedScopes = parseRequestedScopes(queryParams);
  const requestedScopeSet = new Set(requestedScopes);

  for (const scope of scopes) {
    if (!requestedScopeSet.has(scope)) {
      return NextResponse.json(
        { error: `Scope not requested: ${scope}` },
        { status: 400 }
      );
    }
  }

  const identityScopes = extractIdentityScopes(scopes);
  if (identityScopes.length === 0) {
    return NextResponse.json({ staged: false });
  }

  if (!intent_token) {
    return NextResponse.json(
      { error: "Missing intent_token for identity scopes" },
      { status: 400 }
    );
  }

  let intentPayload: Awaited<ReturnType<typeof verifyIdentityIntentToken>>;
  try {
    intentPayload = await verifyIdentityIntentToken(intent_token);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired intent token" },
      { status: 400 }
    );
  }

  if (intentPayload.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Intent token does not match current user" },
      { status: 403 }
    );
  }

  const scopeHash = createScopeHash(scopes);
  if (
    intentPayload.clientId !== clientId ||
    intentPayload.scopeHash !== scopeHash
  ) {
    return NextResponse.json(
      { error: "Intent token does not match request context" },
      { status: 400 }
    );
  }

  const normalizedIdentity = normalizeIdentityFields(identity ?? {});
  const filteredIdentity = filterIdentityByScopes(
    normalizedIdentity,
    identityScopes
  );

  if (Object.keys(filteredIdentity).length === 0) {
    return NextResponse.json({ staged: false });
  }

  const stored = await storeEphemeralClaims(
    session.user.id,
    filteredIdentity,
    scopes,
    {
      clientId,
      scopeHash,
      intentJti: intentPayload.jti,
    }
  );
  if (!stored.ok) {
    if (stored.reason === "intent_reused") {
      return NextResponse.json(
        { error: "Identity intent token has already been used" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "An active identity stage already exists for this user" },
      { status: 409 }
    );
  }

  return NextResponse.json({ staged: true });
}

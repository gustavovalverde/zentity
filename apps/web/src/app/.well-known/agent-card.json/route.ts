import { env } from "@/env";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/well-known";

/**
 * A2A Protocol — Agent Card Discovery
 *
 * Returns a static Agent Card at /.well-known/agent-card.json
 * per the A2A Protocol v0.3 specification (§8, §4.4.1).
 *
 * Agents discover Zentity's identity verification capabilities here,
 * then interact via standard OAuth 2.1 / CIBA flows.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, A2A-Version, A2A-Extensions",
} as const;

function buildAgentCard() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const issuer = getAuthIssuer();

  return {
    name: "Zentity Identity Agent",
    description:
      "Privacy-preserving identity verification and credential issuance using ZK proofs, FHE, and cryptographic commitments",
    version: "1.0.0",
    url: baseUrl,
    provider: {
      organization: "Zentity",
      url: "https://zentity.xyz",
    },

    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },

    securitySchemes: {
      "zentity-oauth2": {
        type: "oauth2",
        flows: {
          authorizationCode: {
            authorizationUrl: joinAuthIssuerPath(issuer, "oauth2/authorize"),
            tokenUrl: joinAuthIssuerPath(issuer, "oauth2/token"),
            pkceRequired: true,
            scopes: {
              openid: "OpenID Connect authentication",
              "proof:age": "ZK proof of age above threshold",
              "proof:nationality": "ZK proof of nationality group membership",
              "proof:identity": "Full identity verification (all proof scopes)",
              identity_verification:
                "Identity verification for credential issuance",
              "identity.name": "User's verified legal name",
              "identity.dob": "User's verified date of birth",
              "identity.nationality": "User's verified nationality",
              "identity.document": "User's verified document details",
            },
          },
        },
      },
      "zentity-oidc": {
        type: "openIdConnect",
        openIdConnectUrl: `${baseUrl}/.well-known/openid-configuration`,
      },
      "agent-auth": {
        type: "agent-auth",
        discoveryUrl: `${baseUrl}/.well-known/agent-configuration`,
      },
    },

    security: [
      { "zentity-oauth2": ["openid"] },
      { "zentity-oidc": ["openid"] },
    ],

    skills: [
      {
        id: "verify-age",
        name: "Age Verification",
        description:
          "Verify user meets a minimum age threshold without revealing date of birth (ZK proof)",
        tags: ["identity", "verification", "zkp"],
        examples: [
          "Verify user is at least 18 years old",
          "Check age requirement for restricted content",
        ],
      },
      {
        id: "verify-nationality",
        name: "Nationality Verification",
        description:
          "Verify user's nationality membership in a country group without revealing specific nationality (ZK proof)",
        tags: ["identity", "verification", "zkp"],
        examples: [
          "Verify user is an EU citizen",
          "Check nationality for cross-border compliance",
        ],
      },
      {
        id: "verify-identity",
        name: "Identity Verification",
        description:
          "Full identity verification covering age, nationality, document validity, and face match (all proof scopes)",
        tags: ["identity", "verification", "zkp", "compliance"],
        examples: [
          "Complete KYC verification for financial services",
          "Full identity check for onboarding",
        ],
      },
      {
        id: "issue-credential",
        name: "Credential Issuance",
        description:
          "Issue an SD-JWT Verifiable Credential with selectively-disclosable verified claims",
        tags: ["identity", "credential", "sd-jwt-vc"],
        examples: [
          "Issue a verifiable credential after identity verification",
          "Create an SD-JWT VC for portable identity",
        ],
      },
      {
        id: "request-pii",
        name: "PII Request (CIBA)",
        description:
          "Request user's PII via CIBA backchannel authorization — requires user approval on their device",
        tags: ["identity", "pii", "ciba", "backchannel"],
        examples: [
          "Request user's name and date of birth for KYC compliance",
          "Retrieve verified nationality via backchannel authorization",
        ],
      },
    ],
  };
}

export function GET() {
  return new Response(JSON.stringify(buildAgentCard()), {
    status: 200,
    headers: {
      "Content-Type": "application/a2a+json",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

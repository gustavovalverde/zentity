import { describe, expect, it } from "vitest";

/**
 * A2A Agent Card Integration Tests
 *
 * Validates the /.well-known/agent-card.json endpoint against
 * the A2A Protocol v0.3 specification.
 */

interface AgentCard {
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  };
  description: string;
  name: string;
  provider: { organization: string; url: string };
  security: Record<string, string[]>[];
  securitySchemes: Record<string, Record<string, unknown>>;
  skills: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
  }[];
  url: string;
  version: string;
}

async function getAgentCard() {
  const { GET } = await import("@/app/.well-known/agent-card.json/route");
  return GET();
}

function parseCard(response: Response): Promise<AgentCard> {
  return response.json() as Promise<AgentCard>;
}

const AGE_OR_THRESHOLD_RE = /age|threshold/;
const URL_PROTOCOL_RE = /^https?:\/\//;

describe("A2A Agent Card — structure", () => {
  it("returns HTTP 200 with valid JSON", async () => {
    const response = await getAgentCard();

    expect(response.status).toBe(200);
    const card = await parseCard(response);
    expect(card).toBeDefined();
  });

  it("includes all required A2A v0.3 top-level fields", async () => {
    const card = await parseCard(await getAgentCard());

    expect(card.name).toBe("Zentity Identity Agent");
    expect(card.description).toContain("identity verification");
    expect(card.version).toBe("1.0.0");
    expect(card.url).toBeDefined();
    expect(card.provider).toBeDefined();
    expect(card.capabilities).toBeDefined();
    expect(card.securitySchemes).toBeDefined();
    expect(card.security).toBeDefined();
    expect(card.skills).toBeDefined();
  });

  it("provider has organization and url", async () => {
    const card = await parseCard(await getAgentCard());

    expect(card.provider.organization).toBe("Zentity");
    expect(card.provider.url).toBe("https://zentity.xyz");
  });

  it("capabilities declares all flags as false (no task server)", async () => {
    const card = await parseCard(await getAgentCard());

    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.capabilities.extendedAgentCard).toBe(false);
  });
});

describe("A2A Agent Card — security schemes", () => {
  it("zentity-oauth2 has OAuth2 authorization code flow with PKCE", async () => {
    const card = await parseCard(await getAgentCard());
    const oauth2 = card.securitySchemes["zentity-oauth2"];

    expect(oauth2.type).toBe("oauth2");

    const flows = oauth2.flows as Record<string, Record<string, unknown>>;
    const authCode = flows.authorizationCode;

    expect(authCode.authorizationUrl).toContain("oauth2/authorize");
    expect(authCode.tokenUrl).toContain("oauth2/token");
    expect(authCode.pkceRequired).toBe(true);
  });

  it("OAuth2 scopes include required scope keys", async () => {
    const card = await parseCard(await getAgentCard());
    const flows = card.securitySchemes["zentity-oauth2"].flows as Record<
      string,
      Record<string, unknown>
    >;
    const scopes = flows.authorizationCode.scopes as Record<string, string>;

    for (const key of [
      "openid",
      "proof:age",
      "proof:nationality",
      "proof:identity",
      "identity_verification",
      "identity.name",
      "identity.dob",
      "identity.nationality",
      "identity.document",
    ]) {
      expect(scopes).toHaveProperty(key);
    }
  });

  it("zentity-oidc has OpenID Connect with discovery URL", async () => {
    const card = await parseCard(await getAgentCard());
    const oidc = card.securitySchemes["zentity-oidc"];

    expect(oidc.type).toBe("openIdConnect");
    expect(oidc.openIdConnectUrl as string).toContain("openid-configuration");
  });

  it("security array references both defined schemes", async () => {
    const card = await parseCard(await getAgentCard());

    expect(Array.isArray(card.security)).toBe(true);
    expect(card.security.length).toBeGreaterThanOrEqual(2);

    const schemeNames = card.security.flatMap(Object.keys);
    expect(schemeNames).toContain("zentity-oauth2");
    expect(schemeNames).toContain("zentity-oidc");
  });
});

describe("A2A Agent Card — skills catalog", () => {
  const EXPECTED_SKILL_IDS = [
    "verify-age",
    "verify-nationality",
    "verify-identity",
    "issue-credential",
    "request-pii",
  ] as const;

  it("contains exactly 5 skills", async () => {
    const card = await parseCard(await getAgentCard());

    expect(card.skills).toHaveLength(5);
  });

  it("includes all expected skill IDs", async () => {
    const card = await parseCard(await getAgentCard());
    const ids = card.skills.map((s) => s.id);

    for (const expectedId of EXPECTED_SKILL_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  it("each skill has required fields and non-empty tags", async () => {
    const card = await parseCard(await getAgentCard());

    for (const skill of card.skills) {
      expect(skill.id).toBeDefined();
      expect(skill.name).toBeDefined();
      expect(Array.isArray(skill.tags)).toBe(true);
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  it("request-pii skill tags include ciba and backchannel", async () => {
    const card = await parseCard(await getAgentCard());
    const piiSkill = card.skills.find((s) => s.id === "request-pii");

    expect(piiSkill).toBeDefined();
    expect(piiSkill?.tags).toContain("ciba");
    expect(piiSkill?.tags).toContain("backchannel");
  });

  it("verify-age description mentions age or threshold", async () => {
    const card = await parseCard(await getAgentCard());
    const ageSkill = card.skills.find((s) => s.id === "verify-age");

    expect(ageSkill).toBeDefined();
    expect(ageSkill?.description.toLowerCase()).toMatch(AGE_OR_THRESHOLD_RE);
  });
});

describe("A2A Agent Card — HTTP headers", () => {
  it("Content-Type is application/a2a+json", async () => {
    const response = await getAgentCard();

    expect(response.headers.get("Content-Type")).toBe("application/a2a+json");
  });

  it("Cache-Control includes max-age=3600", async () => {
    const response = await getAgentCard();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("Access-Control-Allow-Origin is *", async () => {
    const response = await getAgentCard();

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    const { OPTIONS } = await import("@/app/.well-known/agent-card.json/route");
    const response = OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "GET"
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "A2A-Version"
    );
  });
});

describe("A2A Agent Card — URL resolution", () => {
  it("url field is a valid URL", async () => {
    const card = await parseCard(await getAgentCard());

    expect(card.url).toMatch(URL_PROTOCOL_RE);
  });

  it("OAuth2 URLs use the same base URL as the card", async () => {
    const card = await parseCard(await getAgentCard());
    const flows = card.securitySchemes["zentity-oauth2"].flows as Record<
      string,
      Record<string, unknown>
    >;
    const authCode = flows.authorizationCode;

    const authUrl = authCode.authorizationUrl as string;
    const tokenUrl = authCode.tokenUrl as string;

    expect(authUrl).toContain("localhost");
    expect(tokenUrl).toContain("localhost");
  });

  it("OpenID Connect discovery URL uses the same base URL", async () => {
    const card = await parseCard(await getAgentCard());
    const oidc = card.securitySchemes["zentity-oidc"];

    expect(oidc.openIdConnectUrl as string).toContain("localhost");
  });
});

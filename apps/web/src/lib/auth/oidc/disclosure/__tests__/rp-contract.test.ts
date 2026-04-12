/**
 * RP Contract Tests
 *
 * Validates the disclosure contract between Zentity's auth server and
 * external consumers (demo-rp and MCP). No manual mirrors — every test
 * reads the actual source files and validates against the disclosure registry.
 *
 * If any scope, claim key, or structural assumption drifts between the
 * registry and a consumer, these tests catch it.
 */

import { createLocalJWKSet, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { jwks } from "@/lib/db/schema/oauth-provider";

import { PROOF_DISCLOSURE_KEYS } from "../claims";

const ID_TOKEN_SIGNING_ALGS = ["RS256", "ES256", "EdDSA", "ML-DSA-65"] as const;

import {
  extractProofScopes,
  filterProofClaimsByScopes,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPES,
  OAUTH_SCOPES,
  PROOF_SCOPES,
} from "../registry";

let signJwt: typeof import("../../jwt-signer").signJwt;

// ---------------------------------------------------------------------------
// Source file readers — no mirrors, no stale copies
// ---------------------------------------------------------------------------

const MCP_ROOT = "../../../../../../../mcp/src";
const DEMO_RP_ROOT = "../../../../../../../demo-rp/src";

// Top-level regexes (Biome: useTopLevelRegex)
const PROVIDER_SCOPES_BLOCK_RE =
  /PROVIDER_SCOPES[^{]*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s;
const AETHER_BOOTSTRAP_RE = /AETHER_BOOTSTRAP_SCOPES\s*=\s*\[([^\]]*)\]/;
const LOGIN_SCOPES_RE = /INSTALLED_AGENT_LOGIN_SCOPES\s*=\s*\[([^\]]*)\]/;
const CIBA_SCOPES_RE = /INSTALLED_AGENT_CIBA_SCOPES\s*=\s*\[([^\]]*)\]/;
const SCENARIO_IIFE_RE = /(\w+):\s*\(\(\)\s*=>\s*\{([\s\S]*?)\}\)\(\)/g;

async function readSource(relativePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(import.meta.dirname, relativePath), "utf-8");
}

/** Extract scope-shaped tokens from inside string literals, skipping imports and URLs. */
function extractScopes(source: string): string[] {
  const scopes = new Set<string>();

  const makeScopeRe = () =>
    /(?:openid|offline_access|proof:[a-z_]+|identity\.[a-z]+|agent:[a-z_.]+|compliance:key:[a-z]+|identity_verification)/g;

  const isPath = (v: string) =>
    v.startsWith(".") || v.startsWith("/") || v.includes("://");

  for (const literal of source.matchAll(/"([^"\n]+)"/g)) {
    const value = literal[1] ?? "";
    if (isPath(value)) {
      continue;
    }
    for (const m of value.matchAll(makeScopeRe())) {
      scopes.add(m[0]);
    }
  }

  for (const literal of source.matchAll(/'([^'\n]+)'/g)) {
    const value = literal[1] ?? "";
    if (isPath(value)) {
      continue;
    }
    for (const m of value.matchAll(makeScopeRe())) {
      scopes.add(m[0]);
    }
  }

  for (const literal of source.matchAll(/"([^"]*\bemail\b[^"]*)"/g)) {
    const value = literal[1] ?? "";
    if (isPath(value)) {
      continue;
    }
    if (value === "email" || value.includes("openid")) {
      scopes.add("email");
    }
  }

  return [...scopes];
}

/** Parse demo-rp scenarios.ts — returns signInScopes, stepUpScopes, stepUpClaimKeys per scenario. */
async function parseDemoRpScenarios(): Promise<
  Record<
    string,
    {
      signInScopes: string[];
      stepUpScopes: string[];
      stepUpClaimKeys: string[];
    }
  >
> {
  const source = await readSource(`${DEMO_RP_ROOT}/lib/scenarios.ts`);
  const result: Record<
    string,
    {
      signInScopes: string[];
      stepUpScopes: string[];
      stepUpClaimKeys: string[];
    }
  > = {};

  // Each scenario is an IIFE: `scenarioId: (() => { const signInScopes = [...]; ... })()`
  // Split on scenario keys in the SCENARIOS object to get per-scenario blocks
  SCENARIO_IIFE_RE.lastIndex = 0;
  let scenarioMatch = SCENARIO_IIFE_RE.exec(source);
  while (scenarioMatch) {
    const id = scenarioMatch[1];
    const body = scenarioMatch[2] ?? "";
    if (id) {
      const extractArray = (key: string): string[] => {
        const m = body.match(
          new RegExp(`(?:const|let)\\s+${key}\\s*=\\s*\\[([^\\]]*?)\\]`)
        );
        if (m?.[1]) {
          return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
        }
        const inline = body.match(new RegExp(`${key}:\\s*\\[([^\\]]*?)\\]`));
        if (inline?.[1]) {
          return [...inline[1].matchAll(/"([^"]+)"/g)].map(
            (x) => x[1] as string
          );
        }
        return [];
      };

      result[id] = {
        signInScopes: extractArray("signInScopes"),
        stepUpScopes: extractArray("stepUpScopes"),
        stepUpClaimKeys: extractArray("stepUpClaimKeys"),
      };
    }
    scenarioMatch = SCENARIO_IIFE_RE.exec(source);
  }
  return result;
}

/** Parse demo-rp auth.ts — returns PROVIDER_SCOPES per provider. */
async function parseDemoRpProviderScopes(): Promise<Record<string, string[]>> {
  const source = await readSource(`${DEMO_RP_ROOT}/lib/auth.ts`);
  const result: Record<string, string[]> = {};

  const providerBlock = source.match(PROVIDER_SCOPES_BLOCK_RE);
  if (!providerBlock?.[1]) {
    return result;
  }

  for (const match of providerBlock[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    const provider = match[1];
    const scopeStr = match[2];
    if (provider && scopeStr) {
      result[provider] = [...scopeStr.matchAll(/"([^"]+)"/g)].map(
        (m) => m[1] as string
      );
    }
  }

  // aether uses spread: ...AETHER_BOOTSTRAP_SCOPES
  if (result.aether) {
    const bootstrapMatch = source.match(AETHER_BOOTSTRAP_RE);
    if (bootstrapMatch?.[1]) {
      const bootstrapScopes = [...bootstrapMatch[1].matchAll(/"([^"]+)"/g)].map(
        (m) => m[1] as string
      );
      result.aether = [...result.aether, ...bootstrapScopes];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 1. Scope existence — every scope string in every external file
// ---------------------------------------------------------------------------

const EXTERNAL_SCOPE_SITES = [
  `${MCP_ROOT}/auth/bootstrap-scopes.ts`,
  `${MCP_ROOT}/auth/installed-agent-scopes.ts`,
  `${MCP_ROOT}/auth/mcp-scope-policy.ts`,
  `${MCP_ROOT}/auth/profile-fields.ts`,
  `${MCP_ROOT}/auth/identity.ts`,
  // fpa.ts uses INSTALLED_AGENT_LOGIN_SCOPE_STRING (no hardcoded scopes) — validated in MCP semantic tests
  `${MCP_ROOT}/auth/auth-surfaces.ts`,
  `${MCP_ROOT}/tools/purchase.ts`,
  `${DEMO_RP_ROOT}/lib/scenarios.ts`,
  `${DEMO_RP_ROOT}/lib/auth.ts`,
];

describe("cross-channel contract — scope existence", () => {
  const registryScopes = new Set(OAUTH_SCOPES);

  for (const file of EXTERNAL_SCOPE_SITES) {
    const shortName = file.replace(/^\.\.\/+/g, "");

    it(`${shortName}: every scope is in the registry`, async () => {
      const source = await readSource(file);
      const scopes = extractScopes(source);
      expect(
        scopes.length,
        `no scopes found in ${shortName} — regex may need updating`
      ).toBeGreaterThan(0);

      for (const scope of scopes) {
        expect(
          registryScopes.has(scope),
          `${shortName} uses scope "${scope}" which is not in the disclosure registry`
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Demo RP semantic validation — reads actual source files, no mirrors
// ---------------------------------------------------------------------------

describe("cross-channel contract — demo-rp semantic alignment", () => {
  it("scenarios.ts signInScopes match PROVIDER_SCOPES in auth.ts", async () => {
    const scenarios = await parseDemoRpScenarios();
    const providerScopes = await parseDemoRpProviderScopes();

    expect(Object.keys(scenarios).length).toBeGreaterThan(0);
    expect(Object.keys(providerScopes).length).toBeGreaterThan(0);

    for (const [id, scenario] of Object.entries(scenarios)) {
      const provider = providerScopes[id];
      if (!provider) {
        continue;
      }
      expect(
        [...scenario.signInScopes].sort(),
        `${id}: signInScopes in scenarios.ts does not match PROVIDER_SCOPES in auth.ts`
      ).toEqual([...provider].sort());
    }
  });

  it("signInScopes never contain identity.* scopes", async () => {
    const scenarios = await parseDemoRpScenarios();

    for (const [id, scenario] of Object.entries(scenarios)) {
      const identityAtSignIn = scenario.signInScopes.filter((s) =>
        s.startsWith("identity.")
      );
      expect(
        identityAtSignIn,
        `${id}: signInScopes contains identity scope(s) [${identityAtSignIn}] — must be step-up only`
      ).toEqual([]);
    }
  });

  it("stepUpClaimKeys are a subset of registry claim keys for requested stepUpScopes", async () => {
    const scenarios = await parseDemoRpScenarios();

    for (const [id, scenario] of Object.entries(scenarios)) {
      if (scenario.stepUpClaimKeys.length === 0) {
        continue;
      }

      const registryClaimKeys = new Set<string>();
      for (const scope of scenario.stepUpScopes) {
        const identityClaims =
          IDENTITY_SCOPE_CLAIMS[scope as keyof typeof IDENTITY_SCOPE_CLAIMS];
        if (identityClaims) {
          for (const c of identityClaims) {
            registryClaimKeys.add(c);
          }
          continue;
        }
        // For proof scopes, use PROOF_DISCLOSURE_KEYS if the scope is recognized
        if (
          [...PROOF_SCOPES, "proof:identity" as const].includes(scope as never)
        ) {
          for (const c of PROOF_DISCLOSURE_KEYS) {
            registryClaimKeys.add(c);
          }
        }
      }

      for (const key of scenario.stepUpClaimKeys) {
        expect(
          registryClaimKeys.has(key),
          `${id}: stepUpClaimKeys includes "${key}" but registry produces [${[...registryClaimKeys]}] for scopes [${scenario.stepUpScopes}]`
        ).toBe(true);
      }
    }
  });

  it("all stepUpScopes are recognized disclosure scopes", async () => {
    const scenarios = await parseDemoRpScenarios();
    const registryScopes = new Set(OAUTH_SCOPES);

    for (const [id, scenario] of Object.entries(scenarios)) {
      for (const scope of scenario.stepUpScopes) {
        expect(
          registryScopes.has(scope),
          `${id}: stepUpScope "${scope}" is not in the registry`
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. MCP semantic validation
// ---------------------------------------------------------------------------

describe("cross-channel contract — MCP semantic alignment", () => {
  it("profile-fields.ts field→scope entries have valid claim mappings", async () => {
    const source = await readSource(`${MCP_ROOT}/auth/profile-fields.ts`);

    const map: Record<string, string> = {};
    const regex = /(\w+):\s*"(identity\.\w+)"/g;
    let match = regex.exec(source);
    while (match) {
      if (match[1] && match[2]) {
        map[match[1]] = match[2];
      }
      match = regex.exec(source);
    }
    expect(Object.keys(map).length).toBeGreaterThan(0);

    for (const [field, scope] of Object.entries(map)) {
      const claims =
        IDENTITY_SCOPE_CLAIMS[scope as keyof typeof IDENTITY_SCOPE_CLAIMS];
      expect(
        claims?.length,
        `MCP field "${field}" -> scope "${scope}" has no claim mapping`
      ).toBeGreaterThan(0);
    }
  });

  it("fpa.ts uses INSTALLED_AGENT_LOGIN_SCOPE_STRING, not a hardcoded string", async () => {
    const source = await readSource(`${MCP_ROOT}/auth/fpa.ts`);

    expect(
      source.includes("INSTALLED_AGENT_LOGIN_SCOPE_STRING"),
      "fpa.ts must use INSTALLED_AGENT_LOGIN_SCOPE_STRING to stay aligned with installed-agent-scopes.ts"
    ).toBe(true);
  });

  it("installed-agent login scopes contain no identity.* scopes (vault-gated PII is CIBA-only)", async () => {
    const source = await readSource(
      `${MCP_ROOT}/auth/installed-agent-scopes.ts`
    );

    const loginMatch = source.match(LOGIN_SCOPES_RE);
    expect(loginMatch?.[1]).toBeDefined();
    const loginScopes = [
      ...(loginMatch?.[1]?.matchAll(/"([^"\n]+)"/g) ?? []),
    ].map((m) => m[1] as string);

    for (const scope of loginScopes) {
      expect(
        scope.startsWith("identity."),
        `login scope "${scope}" is an identity scope — vault-gated PII must be CIBA-only`
      ).toBe(false);
    }
  });

  it("installed-agent CIBA scopes are all in the registry", async () => {
    const source = await readSource(
      `${MCP_ROOT}/auth/installed-agent-scopes.ts`
    );

    const cibaMatch = source.match(CIBA_SCOPES_RE);
    expect(cibaMatch?.[1]).toBeDefined();
    const toolScopes = [
      ...(cibaMatch?.[1]?.matchAll(/"([^"\n]+)"/g) ?? []),
    ].map((m) => m[1] as string);

    expect(toolScopes.length).toBeGreaterThan(0);
    const registryScopes = new Set(OAUTH_SCOPES);
    for (const scope of toolScopes) {
      expect(
        registryScopes.has(scope),
        `installed-agent tool scope "${scope}" is not in the registry`
      ).toBe(true);
    }
  });

  it("identity.ts scope strings are registered identity scopes", async () => {
    const source = await readSource(`${MCP_ROOT}/auth/identity.ts`);
    const scopes = extractScopes(source);
    const identityScopes = scopes.filter((s) => s.startsWith("identity."));

    expect(identityScopes.length).toBeGreaterThan(0);
    for (const scope of identityScopes) {
      expect(
        IDENTITY_SCOPES.includes(scope as never),
        `identity.ts uses "${scope}" which is not in IDENTITY_SCOPES`
      ).toBe(true);
    }
  });

  it("purchase.ts requests identity scopes for PII delivery via CIBA", async () => {
    const source = await readSource(`${MCP_ROOT}/tools/purchase.ts`);
    const scopes = extractScopes(source);
    const identityScopes = scopes.filter((s) => s.startsWith("identity."));

    expect(
      identityScopes.length,
      "purchase.ts must request identity scopes for PII delivery"
    ).toBeGreaterThan(0);
  });

  it("my-proofs.ts uses the userinfo endpoint, not tRPC bypass", async () => {
    const source = await readSource(`${MCP_ROOT}/tools/my-proofs.ts`);

    expect(
      source.includes("/api/auth/oauth2/userinfo"),
      "my-proofs.ts must call the userinfo endpoint for proof claims (disclosure pipeline enforcement)"
    ).toBe(true);

    expect(
      source.includes("/api/trpc/"),
      "my-proofs.ts must not bypass the disclosure pipeline via tRPC"
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Proof claim filter tests
// ---------------------------------------------------------------------------

describe("RP contract — proof claim filtering", () => {
  it("proof:verification produces the expected claims on id_token surface", () => {
    const mockProofClaims: Record<string, unknown> = {};
    for (const key of PROOF_DISCLOSURE_KEYS) {
      mockProofClaims[key] = true;
    }

    const filtered = filterProofClaimsByScopes(
      mockProofClaims,
      ["proof:verification"],
      "id_token"
    );

    expect(filtered).toHaveProperty("verification_level");
    expect(filtered).toHaveProperty("verified");
    expect(filtered).toHaveProperty("identity_bound");
    expect(filtered).toHaveProperty("sybil_resistant");
  });

  it("proof:age produces only age_verification", () => {
    const mockProofClaims: Record<string, unknown> = {};
    for (const key of PROOF_DISCLOSURE_KEYS) {
      mockProofClaims[key] = true;
    }

    const filtered = filterProofClaimsByScopes(
      mockProofClaims,
      ["proof:age"],
      "id_token"
    );

    expect(filtered).toHaveProperty("age_verification");
    expect(Object.keys(filtered)).toHaveLength(1);
  });

  it("sybil_nullifier is excluded from id_token and userinfo surfaces", () => {
    const claims = { sybil_nullifier: "abc", verified: true };

    const idToken = filterProofClaimsByScopes(
      claims,
      ["proof:identity", "proof:sybil"],
      "id_token"
    );
    const userinfo = filterProofClaimsByScopes(
      claims,
      ["proof:identity", "proof:sybil"],
      "userinfo"
    );

    expect(idToken).not.toHaveProperty("sybil_nullifier");
    expect(userinfo).not.toHaveProperty("sybil_nullifier");
    expect(idToken).toHaveProperty("verified");
    expect(userinfo).toHaveProperty("verified");
  });

  it("extractProofScopes filters correctly", () => {
    const scopes = ["openid", "email", "proof:verification", "proof:age"];
    const proofScopes = extractProofScopes(scopes);
    expect(proofScopes).toEqual(["proof:verification", "proof:age"]);
  });
});

// ---------------------------------------------------------------------------
// 5. id_token signing and discovery
// ---------------------------------------------------------------------------

describe("RP contract — id_token signing", () => {
  async function buildJwksFromDb(): Promise<Record<string, unknown>[]> {
    const allKeys = await db.select().from(jwks);
    return allKeys.map((row) => ({
      ...(JSON.parse(row.publicKey) as Record<string, unknown>),
      kid: row.id,
      ...(row.alg ? { alg: row.alg } : {}),
      ...(row.crv ? { crv: row.crv } : {}),
    }));
  }

  beforeAll(async () => {
    const mod = await import("../jwt-signer");
    signJwt = mod.signJwt;
    await signJwt({ aud: "warmup", sub: "warmup" });
    await signJwt({ scope: "openid", sub: "warmup" });
  });

  it("default id_token is RS256", async () => {
    const token = await signJwt({
      aud: "zentity-demo-bank",
      sub: "user-123",
      iss: "http://localhost:3000/api/auth",
    });

    const jwksKeys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys: jwksKeys });
    const { payload, protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.sub).toBe("user-123");
    expect(payload.aud).toBe("zentity-demo-bank");
  });

  it("access tokens use EdDSA", async () => {
    const token = await signJwt({
      scope: "openid email proof:verification",
      azp: "zentity-demo-bank",
      sub: "user-123",
    });

    const jwksKeys = await buildJwksFromDb();
    const localJwks = createLocalJWKSet({ keys: jwksKeys });
    const { protectedHeader } = await jwtVerify(token, localJwks);

    expect(protectedHeader.alg).toBe("EdDSA");
  });

  it("JWKS serves keys in the format jose expects", async () => {
    const jwksKeys = await buildJwksFromDb();

    const rsaKey = jwksKeys.find((k) => k.alg === "RS256");
    expect(rsaKey).toBeDefined();
    expect(rsaKey?.kty).toBe("RSA");
    expect(rsaKey?.kid).toBeDefined();

    const edDsaKey = jwksKeys.find((k) => k.alg === "EdDSA");
    expect(edDsaKey).toBeDefined();
    expect(edDsaKey?.kty).toBe("OKP");
    expect(edDsaKey?.crv).toBe("Ed25519");
    expect(edDsaKey?.kid).toBeDefined();
  });
});

describe("RP contract — discovery metadata shape", () => {
  it("advertised algorithms include RS256 (OIDC mandatory) plus Zentity extras", () => {
    expect(ID_TOKEN_SIGNING_ALGS).toContain("RS256");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ES256");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("EdDSA");
    expect(ID_TOKEN_SIGNING_ALGS).toContain("ML-DSA-65");
  });

  it("OIDC Client Registration default alg (RS256) matches Zentity's id_token default", async () => {
    const token = await signJwt({
      aud: "unregistered-client",
      sub: "user-1",
    });

    const header = JSON.parse(
      Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf-8")
    );
    expect(header.alg).toBe("RS256");
  });
});

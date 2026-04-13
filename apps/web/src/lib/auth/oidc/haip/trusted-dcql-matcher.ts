import "server-only";

import { createDcqlMatcher } from "@better-auth/haip";

interface TrustedAuthority {
  type: string;
  value: string;
}

interface CredentialQuery {
  trusted_authorities?: TrustedAuthority[];
  [key: string]: unknown;
}

interface DcqlQuery {
  credentials?: CredentialQuery[];
  [key: string]: unknown;
}

interface Presentation {
  claims: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Wraps `createDcqlMatcher()` with AKI-based `trusted_authorities` pre-filtering.
 *
 * When a DCQL query specifies `trusted_authorities` with `type: "aki"`,
 * presentations are filtered to only include those whose issuer certificate
 * chain matches the allowed Authority Key Identifiers.
 *
 * AKI values must be pre-computed and available on the presentation object
 * (as `aki` property or `_aki` claim) since the matcher layer doesn't have
 * access to raw x5c chains.
 */
export function createTrustedDcqlMatcher() {
  const baseMatcher = createDcqlMatcher();

  return async (input: { query: unknown; presentations: Presentation[] }) => {
    const query = input.query as DcqlQuery;
    const credQueries = query?.credentials;

    if (!credQueries?.length) {
      return await baseMatcher(input);
    }

    // Collect required AKI values from all credential queries
    const requiredAkis = new Set<string>();
    for (const cq of credQueries) {
      for (const ta of cq.trusted_authorities ?? []) {
        if (ta.type === "aki") {
          requiredAkis.add(ta.value.toLowerCase());
        }
      }
    }

    if (requiredAkis.size === 0) {
      return await baseMatcher(input);
    }

    // Filter presentations by AKI match
    const filtered = input.presentations.filter((p) => {
      // Resolve AKI from presentation metadata or claims
      let aki: string | undefined;
      if (typeof p.aki === "string") {
        aki = p.aki.toLowerCase();
      } else if (typeof p.claims._aki === "string") {
        aki = (p.claims._aki as string).toLowerCase();
      }

      // No AKI available on presentation — cannot filter, include by default
      if (!aki) {
        return true;
      }

      return requiredAkis.has(aki);
    });

    return await baseMatcher({ ...input, presentations: filtered });
  };
}

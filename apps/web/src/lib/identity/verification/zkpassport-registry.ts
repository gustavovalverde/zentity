import { RegistryClient } from "@zkpassport/registry";
import {
  countryCodeAlpha3ToAlpha2,
  countryCodeAlpha3ToName,
} from "@zkpassport/utils/country";

export type ZkPassportDocType = "passport" | "id_card" | "residence_permit";

const DOC_TYPES: ZkPassportDocType[] = [
  "passport",
  "id_card",
  "residence_permit",
];

/** Support levels per document type for a single country. */
export interface CountrySupport {
  id_card: number;
  passport: number;
  residence_permit: number;
}

/** Country entry with resolved name, flag code, and NFC support data. */
export interface CountryDocumentEntry {
  alpha2: string;
  alpha3: string;
  name: string;
  support: CountrySupport;
}

// Non-standard alpha-3 codes used by the registry
const ALPHA3_OVERRIDES: Record<string, { alpha2: string; name: string }> = {
  RKS: { alpha2: "XK", name: "Kosovo" },
};

const client = new RegistryClient({ chainId: 1 });

/**
 * Enumerates all alpha-3 codes from @zkpassport/utils/country, queries
 * @zkpassport/registry for NFC support levels, and returns sorted entries
 * for countries with any support.
 *
 * Runs server-side (~5ms). Data comes entirely from the libraries —
 * no static copy to maintain.
 */
export async function buildCountryDocumentList(): Promise<
  CountryDocumentEntry[]
> {
  // Discover all alpha-3 codes by brute-forcing the lookup map (~4ms, 251 hits)
  const allAlpha3: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      for (let c = 65; c <= 90; c++) {
        const code = String.fromCharCode(a, b, c);
        if (countryCodeAlpha3ToName(code)) {
          allAlpha3.push(code);
        }
      }
    }
  }

  // Query support for all countries in parallel (~1ms, all sync lookups)
  const entries = await Promise.all(
    allAlpha3.map(async (alpha3) => {
      const results = await Promise.all(
        DOC_TYPES.map((t) => client.isDocumentSupported(alpha3, undefined, t))
      );
      return {
        alpha3,
        support: {
          passport: results[0] ?? 0,
          id_card: results[1] ?? 0,
          residence_permit: results[2] ?? 0,
        },
      };
    })
  );

  // Keep only countries with any NFC support, resolve names
  const result: CountryDocumentEntry[] = [];
  for (const { alpha3, support } of entries) {
    if (
      support.passport === 0 &&
      support.id_card === 0 &&
      support.residence_permit === 0
    ) {
      continue;
    }
    const override = ALPHA3_OVERRIDES[alpha3];
    const name = override?.name ?? countryCodeAlpha3ToName(alpha3);
    const alpha2 = override?.alpha2 ?? countryCodeAlpha3ToAlpha2(alpha3);
    if (!(name && alpha2)) {
      continue;
    }
    result.push({ alpha3, alpha2, name, support });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

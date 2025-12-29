/**
 * Compliance utilities
 *
 * Shared helpers for translating verification status into compliance tiers
 * and ISO country codes into numeric values.
 */

/**
 * Map verification/compliance level to numeric value.
 */
export function getComplianceLevel(status: {
  verified: boolean;
  level: "none" | "basic" | "full";
}): number {
  switch (status.level) {
    case "full":
      return 3;
    case "basic":
      return 2;
    case "none":
      return 1;
    default:
      return 0;
  }
}

/**
 * Map ISO 3166-1 alpha-3 country code to numeric code.
 */
export function countryCodeToNumeric(alphaCode: string): number {
  const countryMap: Record<string, number> = {
    USA: 840,
    DOM: 214,
    MEX: 484,
    CAN: 124,
    GBR: 826,
    DEU: 276,
    FRA: 250,
    ESP: 724,
    ITA: 380,
    PRT: 620,
    NLD: 528,
    BEL: 56,
    CHE: 756,
    AUT: 40,
    POL: 616,
    SWE: 752,
    NOR: 578,
    DNK: 208,
    FIN: 246,
    IRL: 372,
    COL: 170,
    BRA: 76,
    ARG: 32,
    CHL: 152,
    PER: 604,
    VEN: 862,
    AUS: 36,
    NZL: 554,
    JPN: 392,
    KOR: 410,
    CHN: 156,
    IND: 356,
  };

  return countryMap[alphaCode.toUpperCase()] || 0;
}

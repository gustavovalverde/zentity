/**
 * Nationality Data (Static, Client-Safe)
 *
 * ISO 3166-1 country codes and group definitions.
 * This data is public and can be shipped to the client.
 */

// Tree depth - supports up to 2^8 = 256 countries (matches Noir circuit)
export const TREE_DEPTH = 8;

// ISO 3166-1 numeric codes for countries
// Using numeric codes since they're simpler to hash as field elements
export const COUNTRY_CODES: Record<string, number> = {
  // EU countries
  AUT: 40, // Austria
  BEL: 56, // Belgium
  BGR: 100, // Bulgaria
  HRV: 191, // Croatia
  CYP: 196, // Cyprus
  CZE: 203, // Czech Republic
  DNK: 208, // Denmark
  EST: 233, // Estonia
  FIN: 246, // Finland
  FRA: 250, // France
  DEU: 276, // Germany
  GRC: 300, // Greece
  HUN: 348, // Hungary
  IRL: 372, // Ireland
  ITA: 380, // Italy
  LVA: 428, // Latvia
  LTU: 440, // Lithuania
  LUX: 442, // Luxembourg
  MLT: 470, // Malta
  NLD: 528, // Netherlands
  POL: 616, // Poland
  PRT: 620, // Portugal
  ROU: 642, // Romania
  SVK: 703, // Slovakia
  SVN: 705, // Slovenia
  ESP: 724, // Spain
  SWE: 752, // Sweden

  // Additional EEA/Schengen
  ISL: 352, // Iceland
  LIE: 438, // Liechtenstein
  NOR: 578, // Norway
  CHE: 756, // Switzerland

  // LATAM
  ARG: 32, // Argentina
  BOL: 68, // Bolivia
  BRA: 76, // Brazil
  CHL: 152, // Chile
  COL: 170, // Colombia
  CRI: 188, // Costa Rica
  CUB: 192, // Cuba
  DOM: 214, // Dominican Republic
  ECU: 218, // Ecuador
  SLV: 222, // El Salvador
  GTM: 320, // Guatemala
  HND: 340, // Honduras
  MEX: 484, // Mexico
  NIC: 558, // Nicaragua
  PAN: 591, // Panama
  PRY: 600, // Paraguay
  PER: 604, // Peru
  URY: 858, // Uruguay
  VEN: 862, // Venezuela

  // Five Eyes
  AUS: 36, // Australia
  CAN: 124, // Canada
  NZL: 554, // New Zealand
  GBR: 826, // United Kingdom
  USA: 840, // United States
};

// Country group definitions (ISO alpha-3 codes)
export const COUNTRY_GROUPS: Record<string, string[]> = {
  EU: [
    "AUT",
    "BEL",
    "BGR",
    "HRV",
    "CYP",
    "CZE",
    "DNK",
    "EST",
    "FIN",
    "FRA",
    "DEU",
    "GRC",
    "HUN",
    "IRL",
    "ITA",
    "LVA",
    "LTU",
    "LUX",
    "MLT",
    "NLD",
    "POL",
    "PRT",
    "ROU",
    "SVK",
    "SVN",
    "ESP",
    "SWE",
  ],
  EEA: [
    "AUT",
    "BEL",
    "BGR",
    "HRV",
    "CYP",
    "CZE",
    "DNK",
    "EST",
    "FIN",
    "FRA",
    "DEU",
    "GRC",
    "HUN",
    "IRL",
    "ITA",
    "LVA",
    "LTU",
    "LUX",
    "MLT",
    "NLD",
    "POL",
    "PRT",
    "ROU",
    "SVK",
    "SVN",
    "ESP",
    "SWE",
    "ISL",
    "LIE",
    "NOR",
  ],
  SCHENGEN: [
    "AUT",
    "BEL",
    "CZE",
    "DNK",
    "EST",
    "FIN",
    "FRA",
    "DEU",
    "GRC",
    "HUN",
    "ISL",
    "ITA",
    "LVA",
    "LIE",
    "LTU",
    "LUX",
    "MLT",
    "NLD",
    "NOR",
    "POL",
    "PRT",
    "SVK",
    "SVN",
    "ESP",
    "SWE",
    "CHE",
  ],
  LATAM: [
    "ARG",
    "BOL",
    "BRA",
    "CHL",
    "COL",
    "CRI",
    "CUB",
    "DOM",
    "ECU",
    "SLV",
    "GTM",
    "HND",
    "MEX",
    "NIC",
    "PAN",
    "PRY",
    "PER",
    "URY",
    "VEN",
  ],
  FIVE_EYES: ["AUS", "CAN", "NZL", "GBR", "USA"],
};

/**
 * Get nationality code from ISO alpha-3
 */
export function getNationalityCode(alpha3: string): number | undefined {
  return COUNTRY_CODES[alpha3.toUpperCase()];
}

/**
 * Check if a nationality is in a group (without ZK proof)
 */
export function isNationalityInGroup(
  nationalityCode: string,
  groupName: string,
): boolean {
  const upperCode = nationalityCode.toUpperCase();
  const upperGroup = groupName.toUpperCase();
  const countries = COUNTRY_GROUPS[upperGroup];
  return countries?.includes(upperCode) ?? false;
}

/**
 * Get countries in a group
 */
export function getCountriesInGroup(groupName: string): string[] | undefined {
  return COUNTRY_GROUPS[groupName.toUpperCase()];
}

/**
 * List all available groups
 */
export function listGroups(): string[] {
  return Object.keys(COUNTRY_GROUPS);
}

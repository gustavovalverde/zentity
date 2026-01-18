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

// Reverse mapping: numeric code → country name
const COUNTRY_NAMES: Record<number, string> = {
  // EU countries
  40: "Austria",
  56: "Belgium",
  100: "Bulgaria",
  191: "Croatia",
  196: "Cyprus",
  203: "Czech Republic",
  208: "Denmark",
  233: "Estonia",
  246: "Finland",
  250: "France",
  276: "Germany",
  300: "Greece",
  348: "Hungary",
  372: "Ireland",
  380: "Italy",
  428: "Latvia",
  440: "Lithuania",
  442: "Luxembourg",
  470: "Malta",
  528: "Netherlands",
  616: "Poland",
  620: "Portugal",
  642: "Romania",
  703: "Slovakia",
  705: "Slovenia",
  724: "Spain",
  752: "Sweden",

  // Additional EEA/Schengen
  352: "Iceland",
  438: "Liechtenstein",
  578: "Norway",
  756: "Switzerland",

  // LATAM
  32: "Argentina",
  68: "Bolivia",
  76: "Brazil",
  152: "Chile",
  170: "Colombia",
  188: "Costa Rica",
  192: "Cuba",
  214: "Dominican Republic",
  218: "Ecuador",
  222: "El Salvador",
  320: "Guatemala",
  340: "Honduras",
  484: "Mexico",
  558: "Nicaragua",
  591: "Panama",
  600: "Paraguay",
  604: "Peru",
  858: "Uruguay",
  862: "Venezuela",

  // Five Eyes
  36: "Australia",
  124: "Canada",
  554: "New Zealand",
  826: "United Kingdom",
  840: "United States",

  // Additional (from attestation.ts)
  392: "Japan",
  410: "South Korea",
  156: "China",
  356: "India",
};

/**
 * Get country name from ISO 3166-1 numeric code
 */
export function getCountryName(numericCode: number): string {
  return COUNTRY_NAMES[numericCode] || `Unknown (${numericCode})`;
}

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
  GLOBAL: Object.keys(COUNTRY_CODES),
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
  groupName: string
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

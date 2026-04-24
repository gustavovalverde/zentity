export interface ComplianceBadge {
  detail: string;
  label: string;
  variant: "regulation" | "mechanism";
}

export interface RouteScenarioDcrConfig {
  clientName: string;
  grantTypes?: string[];
  requestedScopes: string;
}

export interface RouteScenario {
  acrValues?: string;
  compliance: ComplianceBadge[];
  dcr: RouteScenarioDcrConfig;
  description: string;
  id: string;
  maxAge?: number;
  name: string;
  notShared: string[];
  oauthProviderId: string;
  signInScopes: string[];
  stepUpAction?: string;
  stepUpClaimKeys: string[];
  stepUpScopes: string[];
  tagline: string;
}

export function buildRequestedScopes(
  signInScopes: string[],
  stepUpScopes: string[]
): string {
  return [...new Set([...signInScopes, ...stepUpScopes])].join(" ");
}

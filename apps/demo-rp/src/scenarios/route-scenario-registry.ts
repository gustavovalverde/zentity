import { aetherScenario } from "@/scenarios/aether";
import { aidScenario } from "@/scenarios/aid";
import { bankScenario } from "@/scenarios/bank";
import { exchangeScenario } from "@/scenarios/exchange";
import type { RouteScenario } from "@/scenarios/route-scenario";
import { veripassWalletScenario } from "@/scenarios/veripass/wallet";
import { wineScenario } from "@/scenarios/wine";
import { x402Scenario } from "@/scenarios/x402";

export const ROUTE_SCENARIOS = [
  bankScenario,
  wineScenario,
  exchangeScenario,
  x402Scenario,
  veripassWalletScenario,
  aetherScenario,
  aidScenario,
] as const satisfies readonly RouteScenario[];

export type RouteScenarioId = (typeof ROUTE_SCENARIOS)[number]["id"];

export const ROUTE_SCENARIO_IDS = ROUTE_SCENARIOS.map(
  (scenario) => scenario.id
) as [RouteScenarioId, ...RouteScenarioId[]];

const routeScenarioById = new Map(
  ROUTE_SCENARIOS.map((scenario) => [scenario.id, scenario])
);

export function isRouteScenarioId(id: string): id is RouteScenarioId {
  return routeScenarioById.has(id as RouteScenarioId);
}

export function getRouteScenario(id: RouteScenarioId): RouteScenario {
  const scenario = routeScenarioById.get(id);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return scenario;
}

export function getOAuthProviderId(scenarioId: RouteScenarioId): string {
  return getRouteScenario(scenarioId).oauthProviderId;
}

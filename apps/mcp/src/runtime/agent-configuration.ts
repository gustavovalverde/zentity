import {
  type AgentConfiguration,
  agentConfigurationSchema,
} from "@zentity/sdk/agent-contract";

let cachedAgentConfiguration: AgentConfiguration | undefined;

export async function discoverAgentConfiguration(
  zentityUrl: string
): Promise<AgentConfiguration> {
  if (cachedAgentConfiguration) {
    return cachedAgentConfiguration;
  }

  const url = new URL(
    "/.well-known/agent-configuration",
    zentityUrl
  ).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Agent configuration discovery failed: ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const configuration = agentConfigurationSchema.parse(json);
  cachedAgentConfiguration = configuration;
  return configuration;
}

export function clearAgentConfigurationCache(): void {
  cachedAgentConfiguration = undefined;
}

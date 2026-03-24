import { z } from "zod";

// Keep this schema aligned with
// apps/web/src/lib/auth/oidc/agent-configuration.ts.
const agentBootstrapTokenExchangeSchema = z.object({
  audience: z.string().url(),
  grant_type: z.string().min(1),
  requested_token_type: z.string().min(1),
  scopes_supported: z.array(z.string().min(1)),
  token_use: z.string().min(1),
});

const agentConfigurationSchema = z.object({
  approval_methods: z.array(z.string().min(1)),
  approval_page_url_template: z.string().url(),
  bootstrap_token_exchange: agentBootstrapTokenExchangeSchema,
  capabilities_endpoint: z.string().url(),
  host_registration_endpoint: z.string().url(),
  introspection_endpoint: z.string().url(),
  issuer: z.string().url(),
  jwks_uri: z.string().url(),
  registration_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  supported_algorithms: z.array(z.string().min(1)),
  supported_features: z.object({
    bootstrap_token_exchange: z.boolean(),
    task_attestation: z.boolean(),
    pairwise_agents: z.boolean(),
    risk_graduated_approval: z.boolean(),
    capability_constraints: z.boolean(),
    delegation_chains: z.boolean(),
  }),
});

type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;

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

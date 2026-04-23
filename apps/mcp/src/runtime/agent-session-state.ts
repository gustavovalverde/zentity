import type {
  AgentDisplay,
  AgentSessionGrant,
  RegisteredAgentSession,
} from "@zentity/sdk";

export type AgentRuntimeDisplay = AgentDisplay;
export type AgentRuntimeGrant = AgentSessionGrant;
export type AgentRuntimeState = RegisteredAgentSession;

export class AgentRuntimeStateStore {
  #state: AgentRuntimeState | undefined;

  clear(): void {
    this.#state = undefined;
  }

  getState(): AgentRuntimeState | undefined {
    return this.#state;
  }

  setState(state: AgentRuntimeState | undefined): void {
    this.#state = state;
  }
}

export const agentRuntimeStateStore = new AgentRuntimeStateStore();

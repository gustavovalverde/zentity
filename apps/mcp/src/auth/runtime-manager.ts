import type { JWK } from "jose";

export interface AgentRuntimeGrant {
  capability: string;
  status: string;
}

export interface AgentRuntimeDisplay {
  model?: string;
  name: string;
  runtime?: string;
  version?: string;
}

export interface AgentRuntimeState {
  display: AgentRuntimeDisplay;
  grants: AgentRuntimeGrant[];
  hostId: string;
  sessionId: string;
  sessionPrivateKey: JWK;
  sessionPublicKey: JWK;
}

export class AgentRuntimeManager {
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

export const agentRuntimeManager = new AgentRuntimeManager();

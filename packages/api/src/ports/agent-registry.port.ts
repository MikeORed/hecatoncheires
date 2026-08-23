export interface AgentRegistryRecord {
  agentId: string;
  configName: string;
  roleName: string;
  profileEntityId: string;
  profileArn: string;
  agentType: string;
  modelId: string;
  guardrailId: string;
  status: string;
  breakerState: string;
}

export interface AgentRegistryPort {
  getByAgentId(agentId: string): Promise<AgentRegistryRecord | null>;
  getByProfileEntityId(profileEntityId: string): Promise<AgentRegistryRecord | null>;
  getByConfigName(configName: string): Promise<AgentRegistryRecord | null>;
  updateBreakerState(agentId: string, breakerState: string, status: string): Promise<void>;
}

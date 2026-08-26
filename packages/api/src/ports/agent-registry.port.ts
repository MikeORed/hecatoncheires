export interface RegistryProfileRecord {
  profileArn: string;
  profileEntityId: string;
  modelId: string;
  label: string;
}

export interface AgentRegistryRecord {
  agentId: string;
  configName: string;
  roleName: string;
  profiles: RegistryProfileRecord[];
  agentType: string;
  guardrailId: string;
  status: string;
  breakerState: string;
}

export interface AgentRegistryPort {
  getByAgentId(agentId: string): Promise<AgentRegistryRecord | null>;
  getByProfileArn(profileArn: string): Promise<AgentRegistryRecord | null>;
  getByProfileEntityId(profileEntityId: string): Promise<AgentRegistryRecord | null>;
  getByConfigName(configName: string): Promise<AgentRegistryRecord | null>;
  updateBreakerState(agentId: string, breakerState: string, status: string): Promise<void>;
  listAll(): Promise<AgentRegistryRecord[]>;
}

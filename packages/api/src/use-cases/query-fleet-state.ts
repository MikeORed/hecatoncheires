import type { GrantRecord } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';

export interface FleetAgent {
  agentId: string;
  configName: string;
  agentType: string;
  modelIds: string[];
  status: string;
  breakerState: string;
  grants: GrantRecord[];
}

/**
 * Query-fleet-state use-case.
 *
 * Lists all agents from the Agent Registry and enriches each with
 * their active grants from the grant ledger.
 */
export async function queryFleetState(deps: Dependencies): Promise<FleetAgent[]> {
  const [agents, allGrants] = await Promise.all([
    deps.agentRegistry.listAll(),
    deps.grantLedger.scanAllConfigs(),
  ]);

  const grantsByConfig: Record<string, GrantRecord[]> = {};
  for (const grant of allGrants) {
    if (!grantsByConfig[grant.configName]) {
      grantsByConfig[grant.configName] = [];
    }
    grantsByConfig[grant.configName].push(grant);
  }

  return agents.map((agent) => ({
    agentId: agent.agentId,
    configName: agent.configName,
    agentType: agent.agentType,
    modelIds: agent.profiles.map((p) => p.modelId),
    status: agent.status,
    breakerState: agent.breakerState,
    grants: grantsByConfig[agent.configName] ?? [],
  }));
}

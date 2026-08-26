import { assemblePolicy, SHAPE_CATALOG } from '@hecaton/core';
import type { PolicyAssemblyContext } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';
import { toGrantChangedEvent } from '../adapters/eventbridge/dto/event.mapper.js';

export interface RevokeShapeInput {
  configName: string;
  roleName: string;
  grantId: string;
}

export interface RevokeShapeResult {
  configName: string;
  grantId: string;
  operation: 'revoked';
}

/**
 * Revoke-shape use-case.
 *
 * Deletes the grant from the ledger, reassembles the operating policy from
 * remaining grants, writes the policy to IAM, and emits an event (best-effort).
 */
export async function revokeShape(
  input: RevokeShapeInput,
  deps: Dependencies,
): Promise<RevokeShapeResult> {
  // 1. Delete the grant from the ledger
  await deps.grantLedger.deleteGrant(input.configName, input.grantId);

  // 2. Query remaining grants
  const remainingGrants = await deps.grantLedger.queryGrantsByConfig(input.configName);

  // 3. Assemble the operating policy from remaining grants
  const agentRecord = await deps.agentRegistry.getByConfigName(input.configName);
  const profileArns = agentRecord?.profiles.map((p) => p.profileArn) ?? [];
  const context: PolicyAssemblyContext = { profileArns };
  const policyDocument = assemblePolicy(remainingGrants, SHAPE_CATALOG, context);

  // 4. Write the assembled policy to IAM
  await deps.operatingPolicy.writePolicy(
    input.roleName,
    deps.operatingPolicy.getDefaultPolicyName(),
    policyDocument,
  );

  // 5. Emit grant-changed event (best-effort)
  try {
    const event = toGrantChangedEvent({
      configName: input.configName,
      grantId: input.grantId,
      shapeName: '',
      action: 'revoked',
      timestamp: new Date().toISOString(),
    });
    await deps.busEmitter.emit(event);
  } catch {
    // Best-effort — failure is swallowed
  }

  return {
    configName: input.configName,
    grantId: input.grantId,
    operation: 'revoked',
  };
}

import type { IamPolicyDocument } from '@hecaton/core';

import type { BreakerDependencies } from '../shared/dependencies.js';
import { toBreakerTrippedEvent } from '../adapters/eventbridge/dto/event.mapper.js';

export interface TripBreakerInput {
  configName: string;
  roleName: string;
  agentId: string;
  reason: string;
  alarmName: string;
}

export interface TripBreakerResult {
  configName: string;
  roleName: string;
  operation: 'breaker-tripped';
  trippedAt: string;
}

const DENY_ALL_POLICY: IamPolicyDocument = {
  Version: '2012-10-17',
  Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
};

/**
 * Trip-breaker use-case.
 *
 * Writes a deny-all policy to the agent role (emergency path — no ledger query),
 * then updates registry state, emits a breaker-tripped event, and publishes an
 * SNS notification (all best-effort).
 */
export async function tripBreaker(
  input: TripBreakerInput,
  deps: BreakerDependencies,
): Promise<TripBreakerResult> {
  const trippedAt = new Date().toISOString();

  // 1. Write deny-all policy (MUST succeed — propagate error for retry)
  await deps.operatingPolicy.writePolicy(
    input.roleName,
    deps.operatingPolicy.getDefaultPolicyName(),
    DENY_ALL_POLICY,
  );

  // 2. Update registry breaker state (best-effort)
  try {
    await deps.agentRegistry.updateBreakerState(input.agentId, 'tripped', 'breaker-tripped');
  } catch {
    // Best-effort — failure is swallowed
  }

  // 3. Emit breaker-tripped event (best-effort)
  try {
    const event = toBreakerTrippedEvent({
      configName: input.configName,
      roleName: input.roleName,
      alarmName: input.alarmName,
      reason: input.reason,
      timestamp: trippedAt,
    });
    await deps.busEmitter.emit(event);
  } catch {
    // Best-effort — failure is swallowed
  }

  // 4. Publish SNS notification (best-effort)
  try {
    await deps.snsNotifier.publish(
      `Breaker tripped: ${input.configName}`,
      `Agent ${input.configName} breaker tripped by alarm ${input.alarmName}. Reason: ${input.reason}`,
    );
  } catch {
    // Best-effort — failure is swallowed
  }

  return {
    configName: input.configName,
    roleName: input.roleName,
    operation: 'breaker-tripped',
    trippedAt,
  };
}

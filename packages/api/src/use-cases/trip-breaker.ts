import type { IamPolicyDocument } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';
import { toBreakerTrippedEvent } from '../adapters/eventbridge/dto/event.mapper.js';

const DEFAULT_POLICY_NAME = 'hecaton-operating-policy';

export interface TripBreakerInput {
  configName: string;
  roleName: string;
  reason: string;
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
 * then emits a breaker-tripped event (best-effort).
 */
export async function tripBreaker(
  input: TripBreakerInput,
  deps: Dependencies,
): Promise<TripBreakerResult> {
  const trippedAt = new Date().toISOString();

  // 1. Write deny-all policy
  await deps.operatingPolicy.writePolicy(input.roleName, DEFAULT_POLICY_NAME, DENY_ALL_POLICY);

  // 2. Emit breaker-tripped event (best-effort)
  try {
    const event = toBreakerTrippedEvent({
      configName: input.configName,
      roleName: input.roleName,
      reason: input.reason,
      timestamp: trippedAt,
    });
    await deps.busEmitter.emit(event);
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

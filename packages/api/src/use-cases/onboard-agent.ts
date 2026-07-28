import type { IamPolicyDocument } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';
import { toCapabilityChangedEvent } from '../adapters/eventbridge/dto/event.mapper.js';

const DEFAULT_POLICY_NAME = 'hecaton-operating-policy';

export interface OnboardAgentInput {
  configName: string;
  roleName: string;
}

export interface OnboardAgentResult {
  configName: string;
}

const DENY_ALL_POLICY: IamPolicyDocument = {
  Version: '2012-10-17',
  Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
};

/**
 * Onboard-agent use-case.
 *
 * Writes the initial deny-all operating policy and emits a capability-changed event.
 * Event emission is CRITICAL — throws on failure (NOT best-effort).
 */
export async function onboardAgent(
  input: OnboardAgentInput,
  deps: Dependencies,
): Promise<OnboardAgentResult> {
  // 1. Write deny-all policy
  await deps.operatingPolicy.writePolicy(input.roleName, DEFAULT_POLICY_NAME, DENY_ALL_POLICY);

  // 2. Emit capability-changed event (CRITICAL — throws on failure)
  const event = toCapabilityChangedEvent({
    configName: input.configName,
    action: 'onboarded',
    timestamp: new Date().toISOString(),
  });
  await deps.busEmitter.emit(event);

  return {
    configName: input.configName,
  };
}

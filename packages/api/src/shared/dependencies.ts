import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IAMClient } from '@aws-sdk/client-iam';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SNSClient } from '@aws-sdk/client-sns';
import { InternalError } from '@hecaton/core';

import { GrantLedgerAdapter } from '../adapters/dynamo/grant-ledger.adapter.js';
import { AgentRegistryAdapter } from '../adapters/dynamo/agent-registry.adapter.js';
import { OperatingPolicyAdapter } from '../adapters/iam/operating-policy.adapter.js';
import { BusEmitterAdapter } from '../adapters/eventbridge/bus-emitter.adapter.js';
import { SnsNotifierAdapter } from '../adapters/sns/sns-notifier.adapter.js';
import type { GrantLedgerPort } from '../ports/grant-ledger.port.js';
import type { AgentRegistryPort } from '../ports/agent-registry.port.js';
import type { OperatingPolicyPort } from '../ports/operating-policy.port.js';
import type { BusEmitterPort } from '../ports/bus-emitter.port.js';
import type { SnsNotifierPort } from '../ports/sns-notifier.port.js';

export interface Dependencies {
  grantLedger: GrantLedgerPort;
  operatingPolicy: OperatingPolicyPort;
  busEmitter: BusEmitterPort;
  agentRegistry: AgentRegistryPort;
}

let cached: Dependencies | undefined;

/**
 * Lazy-evaluated factory. Called on first handler invocation, not at module load.
 * Throws InternalError if required environment variables are missing.
 */
export function getDependencies(): Dependencies {
  if (cached) return cached;

  const tableName = requireEnv('GRANT_LEDGER_TABLE_NAME');
  const registryTableName = requireEnv('AGENT_REGISTRY_TABLE_NAME');
  const busArn = requireEnv('OPS_BUS_ARN');
  const policyName = process.env['OPERATING_POLICY_NAME'] ?? 'hecaton-operating-policy';

  const dynamo = new DynamoDBClient({});
  const iam = new IAMClient({});
  const eventbridge = new EventBridgeClient({});

  cached = {
    grantLedger: new GrantLedgerAdapter(dynamo, tableName),
    operatingPolicy: new OperatingPolicyAdapter(iam, policyName),
    busEmitter: new BusEmitterAdapter(eventbridge, busArn),
    agentRegistry: new AgentRegistryAdapter(dynamo, registryTableName),
  };

  return cached;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new InternalError(`Missing required environment variable: ${name}`, { variable: name });
  }
  return value;
}

/** Reset for testing — allows injecting mock dependencies */
export function resetDependencies(): void {
  cached = undefined;
  cachedBreaker = undefined;
}

export interface BreakerDependencies extends Dependencies {
  snsNotifier: SnsNotifierPort;
}

let cachedBreaker: BreakerDependencies | undefined;

/**
 * Lazy-evaluated factory for the breaker handler. Extends base dependencies with SNS notifier.
 * Throws InternalError if required environment variables are missing.
 */
export function getBreakerDependencies(): BreakerDependencies {
  if (cachedBreaker) return cachedBreaker;

  const base = getDependencies();
  const topicArn = requireEnv('SNS_TOPIC_ARN');

  const sns = new SNSClient({});

  cachedBreaker = {
    ...base,
    snsNotifier: new SnsNotifierAdapter(sns, topicArn),
  };

  return cachedBreaker;
}

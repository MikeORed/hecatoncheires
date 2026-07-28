import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IAMClient } from '@aws-sdk/client-iam';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { InternalError } from '@hecaton/core';

import { GrantLedgerAdapter } from '../adapters/dynamo/grant-ledger.adapter.js';
import { OperatingPolicyAdapter } from '../adapters/iam/operating-policy.adapter.js';
import { BusEmitterAdapter } from '../adapters/eventbridge/bus-emitter.adapter.js';
import type { GrantLedgerPort } from '../ports/grant-ledger.port.js';
import type { OperatingPolicyPort } from '../ports/operating-policy.port.js';
import type { BusEmitterPort } from '../ports/bus-emitter.port.js';

export interface Dependencies {
  grantLedger: GrantLedgerPort;
  operatingPolicy: OperatingPolicyPort;
  busEmitter: BusEmitterPort;
}

let cached: Dependencies | undefined;

/**
 * Lazy-evaluated factory. Called on first handler invocation, not at module load.
 * Throws InternalError if required environment variables are missing.
 */
export function getDependencies(): Dependencies {
  if (cached) return cached;

  const tableName = requireEnv('GRANT_LEDGER_TABLE_NAME');
  const busArn = requireEnv('OPS_BUS_ARN');
  const policyName = process.env['OPERATING_POLICY_NAME'] ?? 'hecaton-operating-policy';

  const dynamo = new DynamoDBClient({});
  const iam = new IAMClient({});
  const eventbridge = new EventBridgeClient({});

  cached = {
    grantLedger: new GrantLedgerAdapter(dynamo, tableName),
    operatingPolicy: new OperatingPolicyAdapter(iam, policyName),
    busEmitter: new BusEmitterAdapter(eventbridge, busArn),
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
}

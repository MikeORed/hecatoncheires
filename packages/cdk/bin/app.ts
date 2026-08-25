#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { SharedInfraStack } from '../lib/stacks/shared-infra.stack.js';
import {
  AgentCoreManagedStack,
  AgentCoreManagedStackProps,
} from '../lib/stacks/agentcore-managed.stack.js';

declare const process: { env: Record<string, string | undefined> };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Capitalize the first letter of a string.
 * Used to produce stage-prefixed stack IDs (e.g., 'dev' -> 'Dev').
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a hyphenated configName to a PascalCase stack suffix.
 * E.g., 'test-managed' → 'TestManaged'
 */
function toStackSuffix(configName: string): string {
  return configName
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

const app = new App();

// --- Stage resolution (defaults to 'dev') ---
const stage = (app.node.tryGetContext('stage') as string) ?? 'dev';

// --- Environment resolution from CDK defaults ---
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// --- Shared infrastructure — deployed once per stage ---
const sharedInfra = new SharedInfraStack(app, `Hecaton-${capitalize(stage)}-SharedInfra`, {
  stage,
  env,
});

// --- Per-agent stacks from seed configurations ---
const seedsDir = join(__dirname, '..', 'lib', 'config', 'seeds');
const seedFiles = readdirSync(seedsDir).filter((f) => f.endsWith('.json'));

for (const seedFile of seedFiles) {
  const filePath = join(seedsDir, seedFile);

  let seedConfig: Record<string, unknown>;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    seedConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read or parse seed configuration at ${filePath}: ${message}`);
  }

  // Only process agentcore-managed seeds in this loop
  if (seedConfig.agentType !== 'agentcore-managed') {
    continue;
  }

  const configName = seedConfig.configName as string;
  const stackId = `Hecaton-${capitalize(stage)}-AgentConfig-${toStackSuffix(configName)}`;

  const managedStack = new AgentCoreManagedStack(app, stackId, {
    stage,
    configName,
    agentType: 'agentcore-managed',
    modelId: seedConfig.modelId as string,
    thresholds: seedConfig.thresholds as AgentCoreManagedStackProps['thresholds'],
    harnessConfig: seedConfig.harnessConfig as AgentCoreManagedStackProps['harnessConfig'],
    signalChannel: seedConfig.signalChannel as AgentCoreManagedStackProps['signalChannel'],
    guardrailOverrides: seedConfig.guardrailOverrides as AgentCoreManagedStackProps['guardrailOverrides'],
    sharedInfra: {
      opsBus: sharedInfra.opsBus,
      snsTopic: sharedInfra.snsTopic,
      grantLedgerTable: sharedInfra.grantLedgerTable,
      defaultGuardrailConfig: sharedInfra.defaultGuardrailConfig,
      breakerLambda: sharedInfra.breakerLambda,
      agentRegistryTable: sharedInfra.agentRegistryTable,
      appConfigAppId: sharedInfra.appConfigAppId,
      appConfigEnvId: sharedInfra.appConfigEnvId,
    },
    env,
  } as AgentCoreManagedStackProps);

  managedStack.addDependency(sharedInfra);
}

app.synth();

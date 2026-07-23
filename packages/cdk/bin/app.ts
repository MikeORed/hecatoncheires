#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { SharedInfraStack } from '../lib/stacks/shared-infra.stack.js';

declare const process: { env: Record<string, string | undefined> };

/**
 * Capitalize the first letter of a string.
 * Used to produce stage-prefixed stack IDs (e.g., 'dev' -> 'Dev').
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
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

// --- Per-agent stacks ---
// In production, these are generated from seed JSON files in lib/config/seeds/.
// Below is the pattern for instantiating a concrete AgentConfigStack:
//
// import { AgentConfigStack, AgentConfigStackProps } from '../lib/stacks/agent-config.stack.js';
//
// class SreOpsAgentConfigStack extends AgentConfigStack {
//   constructor(scope: Construct, id: string, props: AgentConfigStackProps) {
//     super(scope, id, props);
//   }
// }
//
// const sreOps = new SreOpsAgentConfigStack(
//   app,
//   `Hecaton-${capitalize(stage)}-AgentConfig-SreOps`,
//   {
//     stage,
//     configName: 'sre-ops',
//     agentType: 'agentcore-managed',
//     modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
//     sharedInfra: {
//       opsBus: sharedInfra.opsBus,
//       snsTopic: sharedInfra.snsTopic,
//       grantLedgerTable: sharedInfra.grantLedgerTable,
//       defaultGuardrailConfig: sharedInfra.defaultGuardrailConfig,
//     },
//     env,
//   },
// );

// Ensure sharedInfra is used — downstream agent stacks reference it (see pattern above)
void sharedInfra;

app.synth();

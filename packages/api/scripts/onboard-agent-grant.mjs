/**
 * Onboard-a-shape validation script.
 *
 * Drives the REAL grant-shape use-case (@hecaton/api) against deployed AWS
 * resources to write a capability shape into an agent's operating policy —
 * flipping it off the deny-by-default resting state. Use this to validate the
 * governance grant path end to end, then inspect the role's operating policy in
 * the IAM console.
 *
 * This is a validation/operator tool, not part of the deployed system. It runs
 * the same code the deployed grant-shape Lambda runs (validateGrant →
 * assemblePolicy → validatePolicySize → operatingPolicy.writePolicy → emit),
 * just invoked locally with real SDK adapters.
 *
 * Authored against commit: 4b915781edb0b785575de39f89ec2228e2d53233
 *
 * Prereqs: build the api package (`pnpm --filter @hecaton/api build`) and set
 * AWS creds in the environment (AWS_PROFILE + AWS_REGION, or exported keys).
 * The shared-infra and agent stacks must be deployed.
 *
 * Usage (PowerShell), from repo root:
 *   $env:AWS_PROFILE = "temp-creds-1"; $env:AWS_REGION = "us-east-1"
 *   node packages/api/scripts/onboard-agent-grant.mjs `
 *     --config test-managed `
 *     --shape core-invocation `
 *     --grant-ledger hecaton-dev-grant-ledger `
 *     --agent-registry hecaton-dev-agent-registry `
 *     --ops-bus arn:aws:events:us-east-1:723944466306:event-bus/hecaton-dev-ops-bus `
 *     --operating-policy-name AgentIdentityOperatingPolicy3DFEACE7
 *
 * The --operating-policy-name MUST match the inline policy name CDK put on the
 * role (from `aws iam list-role-policies`). If omitted, the use-case falls back
 * to `hecaton-operating-policy`, which would create a SECOND inline policy
 * rather than overwriting the deny-all — leaving the agent still denied.
 */
// This script lives inside the @hecaton/api package so it resolves workspace
// packages (@hecaton/core, the AWS SDK clients) via the package's own
// node_modules. It imports the BUILT api output (run `pnpm --filter @hecaton/api
// build` first) and runs under plain `node` — no TS loader needed.
import { generateId, EnvVar } from '@hecaton/core';
import { grantShape } from '../dist/use-cases/grant-shape.js';
import { getDependencies, resetDependencies } from '../dist/shared/dependencies.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const configName = args.config ?? 'test-managed';
const shapeName = args.shape ?? 'core-invocation';
const grantLedger = args['grant-ledger'];
const agentRegistry = args['agent-registry'];
const opsBus = args['ops-bus'];
const operatingPolicyName = args['operating-policy-name'];
const grantedBy = args['granted-by'] ?? 'onboard-agent-grant.mjs';

const missing = [];
if (!grantLedger) missing.push('--grant-ledger');
if (!agentRegistry) missing.push('--agent-registry');
if (!opsBus) missing.push('--ops-bus');
if (!operatingPolicyName) missing.push('--operating-policy-name');
if (missing.length > 0) {
  console.error(`Missing required arguments: ${missing.join(', ')}`);
  console.error('See the header of this script for usage.');
  process.exit(1);
}

// Wire the env the dependency factory reads.
process.env[EnvVar.GRANT_LEDGER_TABLE_NAME] = grantLedger;
process.env[EnvVar.AGENT_REGISTRY_TABLE_NAME] = agentRegistry;
process.env[EnvVar.OPS_BUS_ARN] = opsBus;
process.env[EnvVar.OPERATING_POLICY_NAME] = operatingPolicyName;

async function main() {
  resetDependencies();
  const deps = getDependencies();

  console.log(`\nResolving agent for configName="${configName}"...`);
  const agent = await deps.agentRegistry.getByConfigName(configName);
  if (!agent) {
    console.error(`No agent found in registry for configName "${configName}".`);
    process.exit(1);
  }

  console.log(`  agentId:   ${agent.agentId}`);
  console.log(`  roleName:  ${agent.roleName}`);
  console.log(`  breaker:   ${agent.breakerState} / status: ${agent.status}`);
  console.log(`  profiles:  ${agent.profiles.length}`);
  for (const p of agent.profiles) {
    console.log(`    - ${p.label}: ${p.profileArn}`);
  }

  if (agent.profiles.length === 0) {
    console.error(
      '\nAgent has NO profiles in the registry #META record. The assembled ' +
        'operating policy would be scoped to no profile ARNs. This indicates a ' +
        'registry-seed/#META schema mismatch — aborting so we do not write a ' +
        'useless policy.',
    );
    process.exit(1);
  }

  const grant = {
    grantId: generateId(),
    configName: agent.configName,
    shapeName,
    parameters: {},
    grantedAt: new Date().toISOString(),
    grantedBy,
  };

  console.log(`\nGranting shape "${shapeName}" (grantId ${grant.grantId})...`);
  console.log(`Writing operating policy "${operatingPolicyName}" on role "${agent.roleName}".`);

  const result = await grantShape(grant, agent.roleName, deps);

  console.log('\nGrant applied. The operating policy has been reassembled and written to IAM.');
  console.log('Verify in the console (or CLI):');
  console.log(
    `  aws iam get-role-policy --role-name ${agent.roleName} ` +
      `--policy-name ${operatingPolicyName} --query PolicyDocument`,
  );
  console.log(
    '\nExpect the DenyByDefault statement to be gone, replaced by the ' +
      'core-invocation Allow (InvokeModel/InvokeModelWithResponseStream) scoped ' +
      'to the assigned inference profile ARN.',
  );
  console.log(`\ngrantId: ${result.grantId}`);
}

main().catch((err) => {
  console.error('\nGrant failed:');
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  if (err && typeof err === 'object' && 'details' in err) {
    console.error('details:', JSON.stringify(err.details, null, 2));
  }
  process.exit(1);
});

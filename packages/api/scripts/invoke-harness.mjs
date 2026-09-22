/**
 * Direct SDK harness invoke — the real Task 6 happy path.
 *
 * The AWS CLI at 2.36.50 has no `bedrock-agentcore invoke-harness`, and the
 * console can't target a governed application inference profile. This drives
 * the harness through the JS SDK's InvokeHarnessCommand instead, which sends a
 * Converse-style messages payload. The harness assumes the governed agent role
 * and runs its managed loop against the assigned profile + guardrail, so this
 * exercises the identity boundary on a live agent.
 *
 * Run inside the @hecaton/api package context (resolves @aws-sdk/* from the
 * package's node_modules). Requires AWS creds in the env (AWS_PROFILE +
 * AWS_REGION) and the agent stack deployed.
 *
 * Usage (PowerShell), from repo root:
 *   $env:AWS_PROFILE = "temp-creds-1"; $env:AWS_REGION = "us-east-1"
 *   node packages/api/scripts/invoke-harness.mjs `
 *     --harness-arn arn:aws:bedrock-agentcore:us-east-1:723944466306:harness/hecaton_dev_test_managed_harness-9NbMPyawnb `
 *     --prompt "Say hello in one short sentence." `
 *     [--session my-session-id-at-least-33-characters-long]
 *
 * Interpreting the result:
 *   - success  → the boundary allows the assigned profile + guardrail; grant is active.
 *   - AccessDenied on bedrock:InvokeModel → operating policy is deny-all (resting),
 *     or the guardrail condition on the boundary blocked the managed model call.
 *   - AccessDenied on bedrock-agentcore:* (memory) → floor is missing that action.
 */
import { randomUUID } from 'node:crypto';
import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
} from '@aws-sdk/client-bedrock-agentcore';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const harnessArn = args['harness-arn'];
const prompt = args.prompt ?? 'Say hello in one short sentence.';
// runtimeSessionId must be reasonably long (AgentCore requires >= 33 chars).
const sessionId = args.session ?? `hecaton-invoke-${randomUUID()}${randomUUID()}`.slice(0, 60);

// Optional per-call guardrail + model override. The managed harness forwards
// additionalParams.guardrailConfig to Bedrock on every Converse call, which
// makes the request carry bedrock:GuardrailIdentifier — required to satisfy the
// permission boundary's guardrail condition. Pass --guardrail-id (and optional
// --guardrail-version, --model-id) to exercise the fully-governed path.
const guardrailId = args['guardrail-id'];
const guardrailVersion = args['guardrail-version'] ?? 'DRAFT';
const modelId = args['model-id'];

if (!harnessArn) {
  console.error('Missing required --harness-arn');
  process.exit(1);
}
if (guardrailId && !modelId) {
  console.error(
    'When --guardrail-id is set you must also pass --model-id (the assigned ' +
      'inference profile ARN), because the guardrailConfig lives under a model override.',
  );
  process.exit(1);
}

const client = new BedrockAgentCoreClient({});

async function main() {
  console.log(`\nInvoking harness:\n  ${harnessArn}`);
  console.log(`  session: ${sessionId}`);
  console.log(`  prompt:  ${prompt}\n`);

  const input = {
    harnessArn,
    runtimeSessionId: sessionId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  };

  if (guardrailId) {
    input.model = {
      bedrockModelConfig: {
        modelId,
        apiFormat: 'converse_stream',
        additionalParams: {
          guardrailConfig: {
            guardrailIdentifier: guardrailId,
            guardrailVersion,
            trace: 'enabled_full',
          },
        },
      },
    };
    console.log(`  guardrail: ${guardrailId} (v${guardrailVersion})`);
    console.log(`  model override: ${modelId}`);
  }

  const command = new InvokeHarnessCommand(input);

  const response = await client.send(command);
  console.log(`HTTP ${response.$metadata?.httpStatusCode} (requestId ${response.$metadata?.requestId})\n`);

  // InvokeHarness returns an async event stream. Drain it and print each chunk.
  if (!response.stream) {
    console.log('No stream on response:', JSON.stringify(response, null, 2));
    return;
  }

  let sawAny = false;
  let assembledText = '';
  for await (const event of response.stream) {
    sawAny = true;
    // Each event is a union; log the raw shape and pull out any text deltas.
    const key = Object.keys(event)[0];
    const payload = event[key];

    // Common Converse-stream shapes: contentBlockDelta.delta.text, etc.
    const text =
      payload?.delta?.text ??
      payload?.contentBlockDelta?.delta?.text ??
      payload?.text ??
      undefined;
    if (typeof text === 'string') {
      assembledText += text;
      process.stdout.write(text);
    } else {
      console.log(`\n[event: ${key}] ${JSON.stringify(payload)}`);
    }
  }

  if (!sawAny) console.log('(stream produced no events)');
  if (assembledText) {
    console.log(`\n\n--- assembled text ---\n${assembledText}`);
  }
}

main().catch((err) => {
  console.error('\nInvoke failed:');
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  if (err && typeof err === 'object' && '$metadata' in err) {
    console.error('$metadata:', JSON.stringify(err.$metadata));
  }
  process.exit(1);
});

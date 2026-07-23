import { Construct } from 'constructs';
import {
  AgentConfigStack,
  AgentConfigStackProps,
} from '../../lib/stacks/agent-config.stack.js';

/**
 * TestAgentConfigStack — minimal concrete implementation of AgentConfigStack
 * used exclusively in CDK assertion tests.
 *
 * Proves out the full pattern (SharedInfraStack → AgentConfigStack → inference profile
 * → guardrail → AgentIdentity → IAM resources) without requiring real seed configs
 * or additional constructs (policy modulator, bus channel, etc.).
 */
export class TestAgentConfigStack extends AgentConfigStack {
  constructor(scope: Construct, id: string, props: AgentConfigStackProps) {
    super(scope, id, props);
    // No additional constructs — identity is sufficient for pattern validation
  }
}

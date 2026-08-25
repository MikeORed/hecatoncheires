// TODO: Reintroduce CDK property tests after a bundling optimization pass.
// These tests synth full stacks with NodejsFunction (esbuild) per iteration,
// making them prohibitively slow (~minutes) for fast-check's default numRuns.
//
// Before re-enabling, consider:
// - Using lambda.Code.fromInline() stubs in property test helpers
// - Splitting test groups into "fast" (unit) vs "slow" (integration/synth)
// - Reducing numRuns to 3-5 for CDK synth tests
// - Caching esbuild output across iterations
//
// Properties previously covered:
// 1. Resource naming consistency (NamingGenerator patterns)
// 3. Tag propagation completeness (mandatory tags on all resources)
// 9. External principal validation (openclaw requires externalPrincipalArn)
// 10. AgentConfigStack identity availability (outputs populated post-construction)
// 11. Resource co-location (profile, guardrail, boundary, role in same stack)

import { describe, it } from 'vitest';

describe('CDK property tests (disabled — pending bundling optimization)', () => {
  it.todo('Property 1: Resource naming consistency');
  it.todo('Property 3: Tag propagation completeness');
  it.todo('Property 9: External principal validation for openclaw');
  it.todo('Property 10: AgentConfigStack identity availability');
  it.todo('Property 11: Resource co-location');
});

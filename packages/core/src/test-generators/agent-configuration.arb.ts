import fc from 'fast-check';

/**
 * Arbitrary for valid configName values matching ConfigNamePattern:
 *   ^[a-z][a-z0-9-]*[a-z0-9]$
 * Length: 2–40 characters.
 */
export const arbConfigName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/**
 * Arbitrary producing invalid configName values that violate one or more
 * schema constraints (wrong pattern, too short, too long, empty).
 */
export const arbInvalidConfigName = fc.oneof(
  // Empty string
  fc.constant(''),
  // Single character (too short for the regex which requires start + end)
  fc.constantFrom('a', 'z', '0'),
  // Starts with digit
  fc.stringMatching(/^[0-9][a-z0-9-]*[a-z0-9]$/).filter((s) => s.length >= 2),
  // Starts with hyphen
  fc.stringMatching(/^-[a-z0-9-]*[a-z0-9]$/).filter((s) => s.length >= 2),
  // Ends with hyphen
  fc.stringMatching(/^[a-z][a-z0-9-]*-$/).filter((s) => s.length >= 2),
  // Contains uppercase
  fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
      fc.constantFrom('A', 'B', 'Z'),
      fc.stringMatching(/^[a-z0-9-]*[a-z0-9]$/),
    )
    .map(([pre, upper, post]) => pre + upper + post)
    .filter((s) => s.length >= 2 && s.length <= 40),
  // Too long (> 40 chars)
  fc
    .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
    .filter((s) => s.length >= 41 && s.length <= 60),
);

/**
 * Arbitrary for valid model binding labels matching ModelBindingLabelPattern:
 *   ^[a-z][a-z0-9-]*$
 * Length: 1–30 characters.
 */
export const arbModelBindingLabel = fc
  .stringMatching(/^[a-z][a-z0-9-]*$/)
  .filter((s) => s.length >= 1 && s.length <= 30);

/**
 * Arbitrary for a single valid ModelBinding object.
 */
export const arbModelBinding = fc.record({
  modelId: fc.string({ minLength: 1, maxLength: 100 }),
  label: arbModelBindingLabel,
  thresholds: fc.option(
    fc.record({ outputTokensPerHour: fc.integer({ min: 1, max: 1_000_000 }) }),
    { nil: undefined },
  ),
});

/**
 * Arbitrary for a valid modelBindings array (1–5 entries, unique labels).
 */
export const arbModelBindings = fc
  .array(arbModelBinding, { minLength: 1, maxLength: 5 })
  .filter((bindings) => {
    const labels = bindings.map((b) => b.label);
    return new Set(labels).size === labels.length;
  });

/**
 * Arbitrary for a valid AgentConfiguration object conforming to AgentConfigurationSchema.
 */
export const arbAgentConfiguration = fc.record({
  configName: arbConfigName,
  agentType: fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  ),
  modelBindings: arbModelBindings,
  guardrailId: fc.string({ minLength: 1, maxLength: 100 }),
  guardrailVersion: fc.string({ minLength: 1, maxLength: 50 }),
  owner: fc.string({ minLength: 1, maxLength: 100 }),
});

/**
 * Arbitrary for an invalid AgentConfiguration that will fail schema validation.
 * Uses an invalid configName while keeping other fields valid.
 */
export const arbInvalidAgentConfiguration = fc.record({
  configName: arbInvalidConfigName,
  agentType: fc.constantFrom(
    'agentcore-managed' as const,
    'openclaw' as const,
    'agentcore-runtime' as const,
  ),
  modelBindings: arbModelBindings,
  guardrailId: fc.string({ minLength: 1, maxLength: 100 }),
  guardrailVersion: fc.string({ minLength: 1, maxLength: 50 }),
  owner: fc.string({ minLength: 1, maxLength: 100 }),
});

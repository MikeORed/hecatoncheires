import { describe, it, expect } from 'vitest';
import {
  AgentConfigurationSchema,
  ConfigNamePattern,
} from './agent-configuration.schema.js';

describe('AgentConfigurationSchema', () => {
  const validInput = {
    configName: 'my-agent-01',
    agentType: 'agentcore-managed' as const,
    modelBindings: [
      { modelId: 'anthropic.claude-3-sonnet', label: 'primary' },
    ],
    guardrailId: 'gr-abc123',
    owner: 'team-platform',
  };

  it('accepts valid input and defaults guardrailVersion to DRAFT', () => {
    const result = AgentConfigurationSchema.parse(validInput);
    expect(result.configName).toBe('my-agent-01');
    expect(result.agentType).toBe('agentcore-managed');
    expect(result.modelBindings).toHaveLength(1);
    expect(result.modelBindings[0].modelId).toBe('anthropic.claude-3-sonnet');
    expect(result.modelBindings[0].label).toBe('primary');
    expect(result.guardrailId).toBe('gr-abc123');
    expect(result.guardrailVersion).toBe('DRAFT');
    expect(result.owner).toBe('team-platform');
  });

  it('accepts explicit guardrailVersion', () => {
    const result = AgentConfigurationSchema.parse({
      ...validInput,
      guardrailVersion: '3',
    });
    expect(result.guardrailVersion).toBe('3');
  });

  it('accepts all valid agentType values', () => {
    for (const agentType of [
      'agentcore-managed',
      'openclaw',
      'agentcore-runtime',
    ] as const) {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        agentType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts model binding with optional thresholds', () => {
    const result = AgentConfigurationSchema.parse({
      ...validInput,
      modelBindings: [
        { modelId: 'anthropic.claude-3-sonnet', label: 'primary', thresholds: { outputTokensPerHour: 5000 } },
      ],
    });
    expect(result.modelBindings[0].thresholds?.outputTokensPerHour).toBe(5000);
  });

  it('accepts multiple model bindings with unique labels', () => {
    const result = AgentConfigurationSchema.parse({
      ...validInput,
      modelBindings: [
        { modelId: 'anthropic.claude-3-sonnet', label: 'primary' },
        { modelId: 'anthropic.claude-3-haiku', label: 'fast' },
        { modelId: 'amazon.titan-text-express', label: 'cheap' },
      ],
    });
    expect(result.modelBindings).toHaveLength(3);
  });

  it('accepts up to 5 model bindings', () => {
    const result = AgentConfigurationSchema.safeParse({
      ...validInput,
      modelBindings: [
        { modelId: 'model-a', label: 'a' },
        { modelId: 'model-b', label: 'b' },
        { modelId: 'model-c', label: 'c' },
        { modelId: 'model-d', label: 'd' },
        { modelId: 'model-e', label: 'e' },
      ],
    });
    expect(result.success).toBe(true);
  });

  describe('modelBindings validation', () => {
    it('rejects empty modelBindings array', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 5 model bindings', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [
          { modelId: 'model-a', label: 'a' },
          { modelId: 'model-b', label: 'b' },
          { modelId: 'model-c', label: 'c' },
          { modelId: 'model-d', label: 'd' },
          { modelId: 'model-e', label: 'e' },
          { modelId: 'model-f', label: 'f' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate labels', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [
          { modelId: 'anthropic.claude-3-sonnet', label: 'primary' },
          { modelId: 'anthropic.claude-3-haiku', label: 'primary' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty modelId in a binding', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [{ modelId: '', label: 'primary' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects label starting with a digit', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [{ modelId: 'some-model', label: '1bad' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects label with uppercase letters', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [{ modelId: 'some-model', label: 'Primary' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects label longer than 30 characters', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [{ modelId: 'some-model', label: 'a'.repeat(31) }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-positive outputTokensPerHour', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [
          { modelId: 'some-model', label: 'primary', thresholds: { outputTokensPerHour: 0 } },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer outputTokensPerHour', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelBindings: [
          { modelId: 'some-model', label: 'primary', thresholds: { outputTokensPerHour: 1.5 } },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('configName validation', () => {
    it('rejects empty configName', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects configName starting with uppercase', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: 'MyAgent',
      });
      expect(result.success).toBe(false);
    });

    it('rejects configName starting with a digit', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: '1agent',
      });
      expect(result.success).toBe(false);
    });

    it('rejects configName ending with a hyphen', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: 'my-agent-',
      });
      expect(result.success).toBe(false);
    });

    it('rejects configName longer than 40 characters', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: 'a'.repeat(41),
      });
      expect(result.success).toBe(false);
    });

    it('accepts configName at max 40 characters', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: 'a'.repeat(40),
      });
      expect(result.success).toBe(true);
    });

    it('rejects configName with underscores', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        configName: 'my_agent',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('required non-empty string fields', () => {
    it('rejects empty guardrailId', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        guardrailId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty owner', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        owner: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty guardrailVersion when explicitly provided', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        guardrailVersion: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('invalid agentType', () => {
    it('rejects unrecognized agentType value', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        agentType: 'unknown-type',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('ConfigNamePattern', () => {
  it('is exported and matches valid names', () => {
    expect(ConfigNamePattern.test('my-agent-01')).toBe(true);
    expect(ConfigNamePattern.test('a1')).toBe(true);
    expect(ConfigNamePattern.test('abc')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(ConfigNamePattern.test('')).toBe(false);
    expect(ConfigNamePattern.test('-abc')).toBe(false);
    expect(ConfigNamePattern.test('abc-')).toBe(false);
    expect(ConfigNamePattern.test('ABC')).toBe(false);
  });
});

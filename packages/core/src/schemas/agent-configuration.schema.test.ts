import { describe, it, expect } from 'vitest';
import {
  AgentConfigurationSchema,
  ConfigNamePattern,
} from './agent-configuration.schema.js';

describe('AgentConfigurationSchema', () => {
  const validInput = {
    configName: 'my-agent-01',
    agentType: 'agentcore-managed' as const,
    modelId: 'anthropic.claude-3-sonnet',
    guardrailId: 'gr-abc123',
    owner: 'team-platform',
  };

  it('accepts valid input and defaults guardrailVersion to DRAFT', () => {
    const result = AgentConfigurationSchema.parse(validInput);
    expect(result.configName).toBe('my-agent-01');
    expect(result.agentType).toBe('agentcore-managed');
    expect(result.modelId).toBe('anthropic.claude-3-sonnet');
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
    it('rejects empty modelId', () => {
      const result = AgentConfigurationSchema.safeParse({
        ...validInput,
        modelId: '',
      });
      expect(result.success).toBe(false);
    });

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
